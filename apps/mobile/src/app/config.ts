import { t } from '../localization'
import type { ShelfId } from '../library'

export const appearanceLabels = {
  paperMode: {
    get warm() { return t("Warm") },
    get cool() { return t("Cool") },
    get print() { return t("Print") },
    get night() { return t("Night") },
  },
  contrast: {
    get system() { return t("System") },
    get standard() { return t("Standard") },
    get high() { return t("High") },
  },
  typeScale: {
    standard: '100%',
    large: '113%',
    'x-large': '125%',
  },
  motion: {
    get system() { return t("System") },
    get reduced() { return t("Reduced") },
  },
} as const

export const shelfCopy: Record<ShelfId, { label: string; eyebrow: string; empty: string }> = {
  tbr: {
    get label() { return t("To Be Read") },
    get eyebrow() { return t("A home for every maybe") },
    get empty() { return t("Save something for later") },
  },
  next: {
    get label() { return t("Up Next") },
    get eyebrow() { return t("Your shortest shortlist") },
    get empty() { return t("Choose what comes next") },
  },
  reading: {
    get label() { return t("Reading") },
    get eyebrow() { return t("The books in your hands") },
    get empty() { return t("Start your next read") },
  },
  finished: {
    get label() { return t("Finished") },
    get eyebrow() { return t("A private reading record") },
    get empty() { return t("Finished books land here") },
  },
  dnf: {
    get label() { return t("DNF") },
    get eyebrow() { return t("Did not finish") },
    get empty() { return t("Set a book aside for now") },
  },
}
