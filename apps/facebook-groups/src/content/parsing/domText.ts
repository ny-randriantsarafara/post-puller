export function readElementText(element: Element | null): string {
  if (element === null) {
    return '';
  }

  return element.textContent.trim();
}

export function readTrimmedText(element: Element | null): string {
  return readElementText(element).trim();
}

export function readReferencedSvgText(element: Element | null): string {
  if (element === null) {
    return '';
  }

  const useElement = element.querySelector('use');
  const reference =
    useElement?.getAttribute('href') ?? useElement?.getAttribute('xlink:href');

  if (reference === null || reference === undefined || !reference.startsWith('#')) {
    return '';
  }

  const referencedElement = document.getElementById(reference.slice(1));
  return readTrimmedText(referencedElement);
}

export function readAccessibleText(element: Element | null): string {
  const visibleText = readTrimmedText(element);
  if (visibleText.length > 0) {
    return visibleText;
  }

  const ariaLabel = element?.getAttribute('aria-label')?.trim() ?? '';
  if (ariaLabel.length > 0) {
    return ariaLabel;
  }

  return readReferencedSvgText(element);
}
