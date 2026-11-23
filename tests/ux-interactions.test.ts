import test from 'node:test'
import assert from 'node:assert/strict'
import { isSubmitKey } from '../src/lib/keyboard'
import {
  normalizeCollapseMode,
  resolveThinkingExpanded,
  resolveToolCallExpanded,
} from '../src/lib/collapse-mode'

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

test('smart collapse mode expands thinking while streaming and collapses once finished', () => {
  assert.equal(normalizeCollapseMode('auto'), 'auto')
  assert.equal(normalizeCollapseMode('expanded'), 'expanded')
  assert.equal(normalizeCollapseMode('collapsed'), 'collapsed')
  assert.equal(normalizeCollapseMode('unknown'), 'auto')

  assert.equal(resolveThinkingExpanded('auto', true), true)
  assert.equal(resolveThinkingExpanded('auto', false), false)
  assert.equal(resolveThinkingExpanded('expanded', false), true)
  assert.equal(resolveThinkingExpanded('collapsed', true), false)
})

test('smart collapse mode keeps tool calls collapsed unless an error occurs', () => {
  assert.equal(resolveToolCallExpanded('auto', 'calling'), false)
  assert.equal(resolveToolCallExpanded('auto', 'completed'), false)
  assert.equal(resolveToolCallExpanded('auto', 'error'), true)
  assert.equal(resolveToolCallExpanded('expanded', 'completed'), true)
  assert.equal(resolveToolCallExpanded('collapsed', 'error'), false)
})
