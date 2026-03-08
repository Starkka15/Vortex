import * as fs from "fs";
import * as path from "path";

const BACKUP_DIR_NAME = ".TFCInstaller_Backup";
const BACKUP_INFO_FILE = "backup_info.json";

/**
 * Information about a backup instance.
 */
export interface BackupInfo {
  /** Mod name that created this backup */
  modName: string;
  /** Timestamp of when the backup was created */
  timestamp: string;
  /** List of files that were backed up (relative to game dir) */
  files: string[];
}

/**
 * Manages backups of original game files before modification.
 *
 * Backup structure:
 *   <gameDir>/.TFCInstaller_Backup/
 *     0/                  ← first backup slot
 *       backup_info.json  ← metadata
 *       CookedPCConsole/  ← mirrored directory structure
 *         Package.upk     ← original file
 *     1/                  ← second backup slot (if multiple installs)
 *       ...
 */
export class BackupManager {
  private readonly gameDir: string;
  private readonly backupRoot: string;

  constructor(gameDir: string) {
    this.gameDir = gameDir;
    this.backupRoot = path.join(gameDir, BACKUP_DIR_NAME);
  }

  /**
   * Check if any backup exists.
   */
  hasBackup(): boolean {
    if (!fs.existsSync(this.backupRoot)) return false;
    return this.getBackupSlots().length > 0;
  }

  /**
   * Get all backup slot numbers (sorted ascending).
   */
  getBackupSlots(): number[] {
    if (!fs.existsSync(this.backupRoot)) return [];
    return fs.readdirSync(this.backupRoot, { withFileTypes: true })
      .filter(e => e.isDirectory() && /^\d+$/.test(e.name))
      .map(e => parseInt(e.name, 10))
      .sort((a, b) => a - b);
  }

  /**
   * Get the next available backup slot number.
   */
  private getNextSlot(): number {
    const slots = this.getBackupSlots();
    return slots.length > 0 ? slots[slots.length - 1] + 1 : 0;
  }

  /**
   * Create a new backup slot and return its path.
   */
  createBackup(modName: string): BackupSession {
    const slot = this.getNextSlot();
    const slotDir = path.join(this.backupRoot, String(slot));
    fs.mkdirSync(slotDir, { recursive: true });

    return new BackupSession(this.gameDir, slotDir, modName);
  }

  /**
   * Get the most recent backup info.
   */
  getLatestBackup(): BackupInfo | null {
    const slots = this.getBackupSlots();
    if (slots.length === 0) return null;
    const latestSlot = slots[slots.length - 1];
    return this.readBackupInfo(latestSlot);
  }

  /**
   * Read backup info for a specific slot.
   */
  readBackupInfo(slot: number): BackupInfo | null {
    const infoPath = path.join(this.backupRoot, String(slot), BACKUP_INFO_FILE);
    if (!fs.existsSync(infoPath)) return null;
    try {
      return JSON.parse(fs.readFileSync(infoPath, "utf-8"));
    } catch {
      return null;
    }
  }

  /**
   * Restore files from the most recent backup, removing the backup slot.
   * @returns List of files that were restored
   */
  restoreLatest(): string[] {
    const slots = this.getBackupSlots();
    if (slots.length === 0) return [];
    return this.restoreSlot(slots[slots.length - 1]);
  }

  /**
   * Restore files from a specific backup slot.
   */
  restoreSlot(slot: number): string[] {
    const slotDir = path.join(this.backupRoot, String(slot));
    if (!fs.existsSync(slotDir)) return [];

    const info = this.readBackupInfo(slot);
    const restored: string[] = [];

    if (info) {
      for (const relPath of info.files) {
        const backupFile = path.join(slotDir, relPath);
        const gameFile = path.join(this.gameDir, relPath);

        if (fs.existsSync(backupFile)) {
          // Ensure target directory exists
          const dir = path.dirname(gameFile);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          fs.copyFileSync(backupFile, gameFile);
          restored.push(relPath);
        }
      }
    }

    // Remove the backup slot
    fs.rmSync(slotDir, { recursive: true });

    // Clean up empty backup root
    if (this.getBackupSlots().length === 0 && fs.existsSync(this.backupRoot)) {
      try { fs.rmdirSync(this.backupRoot); } catch { /* not empty */ }
    }

    return restored;
  }
}

/**
 * An active backup session for tracking files during installation.
 */
export class BackupSession {
  private readonly gameDir: string;
  private readonly slotDir: string;
  private readonly modName: string;
  private readonly backedUpFiles: string[] = [];

  constructor(gameDir: string, slotDir: string, modName: string) {
    this.gameDir = gameDir;
    this.slotDir = slotDir;
    this.modName = modName;
  }

  /**
   * Back up a file before modifying it.
   * @param filePath Absolute path to the game file
   */
  backupFile(filePath: string): void {
    if (!fs.existsSync(filePath)) return;

    const relPath = path.relative(this.gameDir, filePath);
    const backupPath = path.join(this.slotDir, relPath);

    // Skip if already backed up in this session
    if (this.backedUpFiles.includes(relPath)) return;

    // Create directory structure in backup
    const dir = path.dirname(backupPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.copyFileSync(filePath, backupPath);
    this.backedUpFiles.push(relPath);
  }

  /**
   * Finalize the backup session — writes the info file.
   */
  commit(): void {
    if (this.backedUpFiles.length === 0) {
      // No files backed up — remove the empty slot
      try { fs.rmSync(this.slotDir, { recursive: true }); } catch { /* ignore */ }
      return;
    }

    const info: BackupInfo = {
      modName: this.modName,
      timestamp: new Date().toISOString(),
      files: this.backedUpFiles,
    };

    fs.writeFileSync(
      path.join(this.slotDir, BACKUP_INFO_FILE),
      JSON.stringify(info, null, 2),
      "utf-8",
    );
  }

  /**
   * Get the list of files that have been backed up so far.
   */
  getBackedUpFiles(): string[] {
    return [...this.backedUpFiles];
  }
}
