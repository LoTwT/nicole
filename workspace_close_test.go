package main

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/egoist/mygo"
)

type closeRecorder struct {
	emitted       []int
	emitErr       error
	destroyed     int
	confirmCalls  int
	confirmReason discardReason
	confirmResult bool
	confirmErr    error
	afterCalls    int
	afterDelay    time.Duration
	after         func()
}

func instrumentClose(workspace *Workspace) *closeRecorder {
	recorder := &closeRecorder{}
	workspace.close.emit = func(_ *mygo.Window, token int) error {
		if recorder.emitErr != nil {
			return recorder.emitErr
		}
		recorder.emitted = append(recorder.emitted, token)
		return nil
	}
	workspace.close.destroy = func(*mygo.Window) {
		recorder.destroyed++
	}
	workspace.close.confirm = func(_ *mygo.Window, reason discardReason) (bool, error) {
		recorder.confirmCalls++
		recorder.confirmReason = reason
		return recorder.confirmResult, recorder.confirmErr
	}
	workspace.close.after = func(delay time.Duration, callback func()) {
		recorder.afterCalls++
		recorder.afterDelay = delay
		recorder.after = callback
	}
	return recorder
}

func fireCloseTimeout(t *testing.T, recorder *closeRecorder) {
	t.Helper()
	if recorder.after == nil {
		t.Fatal("close request did not schedule a timeout")
	}
	recorder.after()
}

func TestCloseWaitsForSaveThenCloses(t *testing.T) {
	workspace := NewWorkspace()
	recorder := instrumentClose(workspace)

	if !workspace.requestClose(nil) {
		t.Fatal("requestClose() = false, want true to prevent the close")
	}
	if want := []int{1}; !reflect.DeepEqual(recorder.emitted, want) {
		t.Fatalf("emitted tokens = %v, want %v", recorder.emitted, want)
	}
	if recorder.afterDelay != closeSaveTimeout || recorder.after == nil {
		t.Fatalf("timeout delay = %v, callback set = %t; want %v and true", recorder.afterDelay, recorder.after != nil, closeSaveTimeout)
	}

	workspace.finishClose(nil, 99, true)
	if recorder.destroyed != 0 {
		t.Fatalf("destroyed = %d after a wrong token, want 0", recorder.destroyed)
	}
	workspace.finishClose(nil, 1, true)
	if recorder.destroyed != 1 {
		t.Fatalf("destroyed = %d after a successful save, want 1", recorder.destroyed)
	}
	if recorder.confirmCalls != 0 {
		t.Errorf("confirm calls = %d after a successful save, want 0", recorder.confirmCalls)
	}
	fireCloseTimeout(t, recorder)
	if recorder.destroyed != 1 {
		t.Errorf("destroyed = %d after the stale timeout, want 1", recorder.destroyed)
	}
}

func TestCloseSaveFailureAsksBeforeClosing(t *testing.T) {
	workspace := NewWorkspace()
	recorder := instrumentClose(workspace)
	recorder.confirmResult = true

	workspace.requestClose(nil)
	workspace.finishClose(nil, 1, false)

	if recorder.confirmCalls != 1 || recorder.confirmReason != discardOnClose {
		t.Fatalf("confirm = %d, %v; want one close confirmation", recorder.confirmCalls, recorder.confirmReason)
	}
	if recorder.destroyed != 1 {
		t.Fatalf("destroyed = %d after choosing to close, want 1", recorder.destroyed)
	}
	fireCloseTimeout(t, recorder)
	if recorder.destroyed != 1 {
		t.Errorf("destroyed = %d after the stale timeout, want 1", recorder.destroyed)
	}
}

func TestCloseSaveFailureCanBeCancelled(t *testing.T) {
	workspace := NewWorkspace()
	recorder := instrumentClose(workspace)
	recorder.confirmResult = false

	workspace.requestClose(nil)
	workspace.finishClose(nil, 1, false)

	if recorder.confirmCalls != 1 {
		t.Fatalf("confirm calls = %d, want 1", recorder.confirmCalls)
	}
	if recorder.destroyed != 0 {
		t.Fatalf("destroyed = %d after cancel, want 0", recorder.destroyed)
	}
	fireCloseTimeout(t, recorder)
	if recorder.destroyed != 0 {
		t.Errorf("destroyed = %d after the stale timeout, want 0", recorder.destroyed)
	}

	if !workspace.requestClose(nil) {
		t.Fatal("requestClose() after cancel = false, want true")
	}
	if len(recorder.emitted) != 2 || recorder.emitted[0] != 1 || recorder.emitted[1] == 1 {
		t.Errorf("emitted tokens after cancel = %v, want a new token after 1", recorder.emitted)
	}
}

func TestCloseTimeoutDestroysAndLateAnswerIsIgnored(t *testing.T) {
	workspace := NewWorkspace()
	recorder := instrumentClose(workspace)

	workspace.requestClose(nil)
	fireCloseTimeout(t, recorder)
	if recorder.destroyed != 1 {
		t.Fatalf("destroyed = %d after the timeout, want 1", recorder.destroyed)
	}
	workspace.finishClose(nil, 1, true)
	if recorder.destroyed != 1 {
		t.Errorf("destroyed = %d after a late answer, want 1", recorder.destroyed)
	}
	if recorder.confirmCalls != 0 {
		t.Errorf("confirm calls = %d after the timeout, want 0", recorder.confirmCalls)
	}
}

func TestRepeatedCloseRequestsEmitOneEvent(t *testing.T) {
	workspace := NewWorkspace()
	recorder := instrumentClose(workspace)

	if !workspace.requestClose(nil) || !workspace.requestClose(nil) {
		t.Fatal("requestClose() did not keep the window open during the handshake")
	}
	if want := []int{1}; !reflect.DeepEqual(recorder.emitted, want) {
		t.Errorf("emitted tokens = %v, want %v", recorder.emitted, want)
	}
	if recorder.afterCalls != 1 {
		t.Errorf("timeout callbacks = %d, want 1", recorder.afterCalls)
	}
}

func TestCloseEmitFailureDoesNotTrapWindow(t *testing.T) {
	workspace := NewWorkspace()
	recorder := instrumentClose(workspace)
	recorder.emitErr = errors.New("page is gone")

	if workspace.requestClose(nil) {
		t.Fatal("requestClose() = true when the event could not be sent, want false")
	}
	if recorder.afterCalls != 0 {
		t.Errorf("timeout callbacks = %d after an emit failure, want 0", recorder.afterCalls)
	}
	if recorder.destroyed != 0 {
		t.Errorf("destroyed = %d after an emit failure, want 0", recorder.destroyed)
	}
}

func TestConfirmDiscardUsesSwitchPrompt(t *testing.T) {
	workspace := NewWorkspace()
	recorder := instrumentClose(workspace)
	recorder.confirmResult = true

	discard, err := workspace.ConfirmDiscard(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !discard {
		t.Error("ConfirmDiscard() = false, want the injected choice")
	}
	if recorder.confirmCalls != 1 || recorder.confirmReason != discardOnSwitch {
		t.Errorf("confirm = %d, %v; want one switch confirmation", recorder.confirmCalls, recorder.confirmReason)
	}
}

func TestCloseConfirmErrorLeavesWindowOpen(t *testing.T) {
	workspace := NewWorkspace()
	recorder := instrumentClose(workspace)
	recorder.confirmErr = errors.New("dialog unavailable")

	workspace.requestClose(nil)
	workspace.finishClose(nil, 1, false)

	if recorder.destroyed != 0 {
		t.Errorf("destroyed = %d after a dialog error, want 0", recorder.destroyed)
	}
	if !workspace.requestClose(nil) {
		t.Error("requestClose() after a dialog error = false, want a new attempt")
	}
}
