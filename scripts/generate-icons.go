//go:build ignore

// Run from the repository root with go run ./scripts/generate-icons.go.
package main

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"log"
	"math"
	"os"
	"path/filepath"
)

func readPNG(path string) (*image.NRGBA, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	source, err := png.Decode(file)
	if err != nil {
		return nil, err
	}
	bounds := source.Bounds()
	if bounds.Dx() != bounds.Dy() {
		return nil, fmt.Errorf("%s must be square", path)
	}
	result := image.NewNRGBA(image.Rect(0, 0, bounds.Dx(), bounds.Dy()))
	draw.Draw(result, result.Bounds(), source, bounds.Min, draw.Src)
	return result, nil
}

// The approved dark rendering has a black canvas outside its rounded tile.
// Only flood-filled border pixels become transparent; the interior artwork
// stays intact. Both appearances use this mask to keep the same enclosure.
func canvasMask(source *image.NRGBA) ([]bool, error) {
	size := source.Bounds().Dx()
	outside := make([]bool, size*size)
	queue := make([]int, 0, size*size/4)
	visit := func(x, y int) {
		if x < 0 || y < 0 || x >= size || y >= size {
			return
		}
		index := y*size + x
		pixel := source.NRGBAAt(x, y)
		if outside[index] || max(pixel.R, pixel.G, pixel.B) > 28 {
			return
		}
		outside[index] = true
		queue = append(queue, index)
	}
	for edge := range size {
		visit(edge, 0)
		visit(edge, size-1)
		visit(0, edge)
		visit(size-1, edge)
	}
	for next := 0; next < len(queue); next++ {
		x, y := queue[next]%size, queue[next]/size
		visit(x-1, y)
		visit(x+1, y)
		visit(x, y-1)
		visit(x, y+1)
	}
	if len(queue) == 0 || len(queue) > size*size/3 {
		return nil, fmt.Errorf("unexpected outer canvas: %d pixels", len(queue))
	}
	return outside, nil
}

func clearCanvas(source *image.NRGBA, outside []bool) {
	size := source.Bounds().Dx()
	for index, clear := range outside {
		if clear {
			source.SetNRGBA(index%size, index/size, color.NRGBA{})
		}
	}
}

// Average premultiplied channels so transparent corners do not leave dark
// fringes when the approved artwork is reduced to application and UI sizes.
func resize(source *image.NRGBA, size int) *image.NRGBA {
	width := source.Bounds().Dx()
	result := image.NewNRGBA(image.Rect(0, 0, size, size))
	scale := float64(width) / float64(size)
	for y := range size {
		for x := range size {
			var red, green, blue, alpha, count float64
			x0, x1 := float64(x)*scale, float64(x+1)*scale
			y0, y1 := float64(y)*scale, float64(y+1)*scale
			for sy := int(y0); float64(sy) < y1; sy++ {
				wy := min(y1, float64(sy+1)) - max(y0, float64(sy))
				for sx := int(x0); float64(sx) < x1; sx++ {
					weight := wy * (min(x1, float64(sx+1)) - max(x0, float64(sx)))
					r, g, b, a := source.At(sx, sy).RGBA()
					red += float64(r) * weight
					green += float64(g) * weight
					blue += float64(b) * weight
					alpha += float64(a) * weight
					count += weight
				}
			}
			result.Set(x, y, color.RGBA64{
				R: uint16(math.Round(red / count)), G: uint16(math.Round(green / count)),
				B: uint16(math.Round(blue / count)), A: uint16(math.Round(alpha / count)),
			})
		}
	}
	return result
}

func writePNG(path string, source image.Image) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, source); err != nil {
		return err
	}
	// MyGo watches native resources; leave unchanged exports alone so a web
	// mark update does not unnecessarily rebuild and restart the native app.
	if current, err := os.ReadFile(path); err == nil && bytes.Equal(current, encoded.Bytes()) {
		return nil
	}
	return os.WriteFile(path, encoded.Bytes(), 0o644)
}

func generate() error {
	dark, err := readPNG("assets/icons/icon-dark.png")
	if err != nil {
		return err
	}
	light, err := readPNG("assets/icons/icon-light.png")
	if err != nil {
		return err
	}
	if dark.Bounds() != light.Bounds() || dark.Bounds().Dx() < 1024 {
		return fmt.Errorf("icon sources must have matching dimensions of at least 1024 pixels")
	}
	outside, err := canvasMask(dark)
	if err != nil {
		return err
	}
	clearCanvas(dark, outside)
	clearCanvas(light, outside)
	mark, err := readPNG("assets/icons/brand-mark.png")
	if err != nil {
		return err
	}
	if mark.Bounds().Dx() < 256 || mark.NRGBAAt(0, 0).A != 0 {
		return fmt.Errorf("brand mark must be at least 256 pixels with a transparent background")
	}
	for _, output := range []struct {
		path   string
		source *image.NRGBA
		size   int
	}{
		{"resources/icon.png", dark, 1024},
		{"src/assets/icon-dark.png", dark, 256},
		{"src/assets/icon-light.png", light, 256},
		{"src/assets/brand-mark.png", mark, 256},
	} {
		if err := writePNG(output.path, resize(output.source, output.size)); err != nil {
			return err
		}
		fmt.Println(output.path)
	}
	return nil
}

func main() {
	if err := generate(); err != nil {
		log.Fatal(err)
	}
}
