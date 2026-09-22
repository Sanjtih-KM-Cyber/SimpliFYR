let openModalCount = 0

export function isAnyModalOpen(): boolean {
  return openModalCount > 0
}

export function modalOpened() {
  openModalCount++
}

export function modalClosed() {
  openModalCount--
}
