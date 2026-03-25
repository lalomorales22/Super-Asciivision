import { createContext } from "react";
import type { MediaAsset } from "../types";

export interface ShellChromeActions {
  openBrowserPreview: (html: string) => void;
  openEditorAsset: (asset: MediaAsset) => void;
}

export const ShellChromeContext = createContext<ShellChromeActions | null>(null);
