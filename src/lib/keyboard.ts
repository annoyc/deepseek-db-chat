interface SubmitKeyEvent {
  key: string
  shiftKey: boolean
  nativeEvent?: { isComposing?: boolean; keyCode?: number }
}

/** keyCode 229 also covers browsers that end composition before keydown. */
export function isSubmitKey(event: SubmitKeyEvent): boolean {
  return event.key === 'Enter' && !event.shiftKey && !event.nativeEvent?.isComposing && event.nativeEvent?.keyCode !== 229
}
