export { LEGACY_VERSION } from "./FMipEntry";
export type { FMipEntry } from "./FMipEntry";
export { readFMipEntry, writeFMipEntry } from "./FMipEntry";

export type { FTextureEntry } from "./FTextureEntry";
export { readFTextureEntry, writeFTextureEntry, getTextureEntrySize, getTextureTfcFullName } from "./FTextureEntry";

export { CURRENT_VERSION } from "./MappingFile";
export type { MappingFileData } from "./MappingFile";
export {
  readMappingFile,
  readMappingFileFromBuffer,
  writeMappingFile,
  writeMappingFileToBuffer,
  readMappingFileEntryCount,
} from "./MappingFile";
