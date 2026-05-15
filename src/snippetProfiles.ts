import { existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import * as path from 'path';

export const PROFILE_ROOT_DIR = 'profiles';

export interface SnippetFileEntry {
  filePath: string;
  language: string;
  profile: string;
  scope: 'base' | 'profile';
}

export function normalizeProfileName(profile: string | undefined) {
  return (profile || '').trim();
}

export function getProfilesDir(snippetDir: string) {
  return path.join(snippetDir, PROFILE_ROOT_DIR);
}

export function getProfileDir(snippetDir: string, profile: string) {
  return path.join(getProfilesDir(snippetDir), profile);
}

function isHsnipsFile(filePath: string) {
  return path.extname(filePath).toLowerCase() == '.hsnips';
}

function readSnippetFileEntries(
  directory: string,
  scope: SnippetFileEntry['scope'],
  profile = ''
) {
  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(directory)
    .filter((file) => isHsnipsFile(file))
    .sort((a, b) => a.localeCompare(b))
    .map((file) => {
      let filePath = path.join(directory, file);
      return {
        filePath,
        language: path.basename(file, '.hsnips').toLowerCase(),
        profile,
        scope,
      };
    });
}

export function discoverSnippetProfiles(snippetDir: string) {
  let profilesDir = getProfilesDir(snippetDir);
  if (!existsSync(profilesDir)) {
    return [];
  }

  return readdirSync(profilesDir)
    .filter((name) => {
      let filePath = path.join(profilesDir, name);
      return statSync(filePath).isDirectory();
    })
    .sort((a, b) => a.localeCompare(b));
}

export function getSnippetFilesForProfile(snippetDir: string, activeProfile = '') {
  let profile = normalizeProfileName(activeProfile);
  let files = readSnippetFileEntries(snippetDir, 'base');
  if (profile) {
    files.push(...readSnippetFileEntries(getProfileDir(snippetDir, profile), 'profile', profile));
  }
  return files;
}

export function ensureProfileDir(snippetDir: string, profile: string) {
  let profileDir = getProfileDir(snippetDir, normalizeProfileName(profile));
  mkdirSync(profileDir, { recursive: true });
  return profileDir;
}
