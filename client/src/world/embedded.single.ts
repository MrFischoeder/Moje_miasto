// Wersja jednoplikowa: teren Warszawy wbudowany jako data URL (Londyn: płaski, plik byłby za duży).
import warszawa from '../../public/terrain/warszawa.bin.gz?url';
export const EMBEDDED_TERRAIN: Record<string, string> = { warszawa };
