#!/usr/bin/env node
/**
 * 在安装后给 @applemusic-like-lyrics/core 打补丁（AMLL 强调词辉光修复）。
 *
 * 不用 pnpm patchedDependencies：pnpm 12 的 frozen lockfile 校验对该补丁报
 * ERR_PNPM_UNCHECKABLE_PATCH_HASH，导致 CI 无法安装依赖。这里在 postinstall
 * 阶段直接应用 patches/ 下的 unified diff，lockfile 保持干净。
 */

import { readFileSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.env.AMLL_PATCH_ROOT ?? "node_modules/@applemusic-like-lyrics/core";
const PATCH_FILE = "patches/@applemusic-like-lyrics__core@0.6.0.patch";

/**
 * 解析 unified diff，返回每个目标文件的 hunk 列表
 * @param {string} diff - patch 文本
 * @returns {Map<string, { oldLines: string[], newLines: string[] }[]>}
 */
const parsePatch = (diff) => {
  const files = new Map();
  let current = null;
  let hunk = null;
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("diff --git ")) {
      const match = raw.match(/ b\/(.+)$/);
      current = match ? match[1] : null;
      hunk = null;
      continue;
    }
    if (!current) continue;
    if (raw.startsWith("@@")) {
      hunk = { oldLines: [], newLines: [] };
      if (!files.has(current)) files.set(current, []);
      files.get(current).push(hunk);
      continue;
    }
    if (!hunk || raw.startsWith("--- ") || raw.startsWith("+++ ") || raw.startsWith("index ")) {
      continue;
    }
    if (raw.startsWith("\\ No newline")) continue;
    const marker = raw[0];
    const text = raw.slice(1);
    if (marker === "-") hunk.oldLines.push(text);
    else if (marker === "+") hunk.newLines.push(text);
    else if (marker === " ") {
      hunk.oldLines.push(text);
      hunk.newLines.push(text);
    }
  }
  return files;
};

/**
 * 在目标行数组中查找连续片段
 * @param {string[]} lines - 目标文件行
 * @param {string[]} needle - 待查找的连续行
 * @param {number} from - 起始下标
 * @returns {number} 命中下标，未命中 -1
 */
const findBlock = (lines, needle, from = 0) => {
  if (needle.length === 0) return -1;
  for (let i = from; i <= lines.length - needle.length; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (lines[i + j] !== needle[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return i;
  }
  return -1;
};

const patchText = readFileSync(PATCH_FILE, "utf8");
const files = parsePatch(patchText);
let changed = 0;
let applied = 0;

for (const [rel, hunks] of files) {
  const target = path.join(ROOT, rel);
  if (!existsSync(target)) {
    console.log(`[amll-patch] 跳过不存在的文件：${target}`);
    continue;
  }
  let lines = readFileSync(target, "utf8").split("\n");
  for (const hunk of hunks) {
    // 已打过补丁：新内容已存在
    if (findBlock(lines, hunk.newLines) !== -1 && findBlock(lines, hunk.oldLines) === -1) {
      applied++;
      continue;
    }
    const at = findBlock(lines, hunk.oldLines);
    if (at === -1) {
      console.error(`[amll-patch] 补丁无法应用：${rel}`);
      process.exit(1);
    }
    lines = [...lines.slice(0, at), ...hunk.newLines, ...lines.slice(at + hunk.oldLines.length)];
    changed++;
  }
  writeFileSync(target, lines.join("\n"));
}

if (changed === 0) {
  console.log(`[amll-patch] 无需改动（已应用 ${applied} 处）`);
} else {
  console.log(`[amll-patch] 已应用 ${changed} 处，跳过 ${applied} 处`);
}
