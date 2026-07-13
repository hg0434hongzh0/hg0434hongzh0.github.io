#!/usr/bin/env node

const path = require('path');
const { buildSite } = require('../lib/publisher');

function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const root = path.resolve(optionValue('--root') || path.join(__dirname, '..', '..', '..'));
const result = buildSite(root, {
  postsDirectory: optionValue('--posts') || 'content/posts',
  outputDirectory: optionValue('--output') || 'dist',
  baseUrl: optionValue('--base-url') || 'https://hongzh0.wiki/'
});

console.log(`Built ${result.posts.length} post(s) into ${result.outputDirectory}`);
