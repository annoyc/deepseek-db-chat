import test from 'node:test'
import assert from 'node:assert/strict'
import { isSubmitKey } from '../src/lib/keyboard'

test('Chinese IME composition and legacy composition events never submit', () => {
  assert.equal(isSubmitKey({ key: 'Enter', shiftKey: false, nativeEvent: { isComposing: true } }), false)
  assert.equal(isSubmitKey({ key: 'Enter', shiftKey: false, nativeEvent: { isComposing: false, keyCode: 229 } }), false)
})

test('only a plain Enter after composition submits, preserving Shift+Enter for newlines', () => {
  assert.equal(isSubmitKey({ key: 'Enter', shiftKey: false, nativeEvent: { isComposing: false, keyCode: 13 } }), true)
  assert.equal(isSubmitKey({ key: 'Enter', shiftKey: true }), false)
  assert.equal(isSubmitKey({ key: 'Process', shiftKey: false, nativeEvent: { keyCode: 229 } }), false)
  assert.equal(isSubmitKey({ key: 'Escape', shiftKey: false }), false)
})
