/**
 * Built-in GameProfile XML strings for supported games.
 * Used as fallback when a mod doesn't include its own GameProfile.xml.
 */

const DISHONORED_PROFILE = `<GameProfile packageFileVersion="801" packageLicenseeVersion="30" enableCustomTFCs="true" enableTFCNamePropertyCleanup="true" removeLODBias="false" removeLODGroup="false" hasHashCheck="false" enableObjectDataShift="false" enableExpandTables="true" updateUITextureSizeProperties="false" enableNewCompressedChunks="true" TFCMappingFileName="Dishonored">
  <DLCs>
    <DLC displayName="Dunwall City Trials" TFCMappingFileName="DLC05_DunwallCityTrials">
      <PackageFolders>
        <PackageFolder path="DishonoredGame\\CookedPCConsole\\DLC\\PCConsole\\DLC05" customTFCStartIndex="5000" />
      </PackageFolders>
    </DLC>
    <DLC displayName="The Knife of Dunwall" TFCMappingFileName="DLC06_TheKnifeOfDunwall">
      <PackageFolders>
        <PackageFolder path="DishonoredGame\\DLC\\PCConsole\\DLC06" customTFCStartIndex="6000" />
      </PackageFolders>
    </DLC>
    <DLC displayName="The Brigmore Witches" TFCMappingFileName="DLC07_TheBrigmoreWitches">
      <PackageFolders>
        <PackageFolder path="DishonoredGame\\DLC\\PCConsole\\DLC07" customTFCStartIndex="7000" />
      </PackageFolders>
    </DLC>
  </DLCs>
  <PackageFolders>
    <PackageFolder path="DishonoredGame\\CookedPCConsole" TFCpath="DishonoredGame\\CookedPCConsole" customTFCStartIndex="0" />
  </PackageFolders>
</GameProfile>`;

const BIOSHOCK_REMASTERED_PROFILE = `<GameProfile packageFileVersion="142" packageLicenseeVersion="56" enableCustomTFCs="true" enableTFCNamePropertyCleanup="true" removeLODBias="false" removeLODGroup="false" hasHashCheck="false" enableObjectDataShift="false" enableExpandTables="true" updateUITextureSizeProperties="false" enableNewCompressedChunks="true" displayName="Bioshock Remastered" TFCMappingFileName="BioshockRemastered">
  <DLCs />
  <PackageFolders>
    <PackageFolder path="Build\\Final\\BakedScripts\\pc" TFCpath="ContentBaked\\pc\\BulkContent" customTFCStartIndex="0" />
    <PackageFolder path="ContentBaked\\pc\\Maps" TFCpath="ContentBaked\\pc\\BulkContent" customTFCStartIndex="0" />
  </PackageFolders>
</GameProfile>`;

/**
 * Map of Vortex game IDs to their default GameProfile XML.
 */
const DEFAULT_PROFILES: Record<string, string> = {
  dishonored: DISHONORED_PROFILE,
  bioshock: BIOSHOCK_REMASTERED_PROFILE,
};

/**
 * Get the default GameProfile XML for a game, or undefined if not available.
 */
export function getDefaultProfileXml(gameId: string): string | undefined {
  return DEFAULT_PROFILES[gameId.toLowerCase()];
}
