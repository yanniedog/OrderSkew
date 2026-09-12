// Keep cached calculator scripts and styles aligned with the current HTML.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

function versionAssets(html, readAsset) {
    let count = 0;
    const assets = {};
    const updated = html.replace(/(<(?:script|link)\b[^>]*\b(?:src|href)\s*=\s*["'])([^"']+)(["'])/gi,
        (match, prefix, url, quote) => {
            const [assetPath, rawQuery] = url.split('?');
            const file = assetPath.replace(/^calculator-assets\/([\w.-]+)\.[a-f0-9]{12}\.(js|css)$/, '$1.$2');
            if (!/^[\w.-]+\.(?:js|css)$/.test(file)) return match;
            const content = readAsset(file).replace(/\r\n/g, '\n');
            const hash = createHash('sha256').update(content).digest('hex').slice(0, 12);
            const target = `calculator-assets/${file.replace(/\.(js|css)$/, `.${hash}.$1`)}`;
            const query = new URLSearchParams(rawQuery);
            query.delete('v');
            assets[target] = content;
            count++;
            return `${prefix}${target}${query.size ? `?${query}` : ''}${quote}`;
        });
    if (!count) throw Error('No calculator assets found in index.html.');
    return { html: updated, count, assets };
}

function writeAssets(root, assets, check) {
    const directory = path.join(root, 'calculator-assets');
    const files = fs.existsSync(directory) ? fs.readdirSync(directory) : [];
    const stale = files.filter(file => /^[\w.-]+\.[a-f0-9]{12}\.(?:js|css)$/.test(file)
        && !Object.hasOwn(assets, `calculator-assets/${file}`));
    const mismatches = Object.entries(assets).filter(([file, content]) => {
        const target = path.join(root, file);
        return !fs.existsSync(target) || fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') !== content;
    });
    if (check) return !stale.length && !mismatches.length;
    fs.mkdirSync(directory, { recursive: true });
    for (const [file, content] of mismatches) fs.writeFileSync(path.join(root, file), content);
    // Only remove generated filenames inside this dedicated directory.
    for (const file of stale) fs.unlinkSync(path.join(directory, file));
    return true;
}

if (require.main === module) {
    const root = path.join(__dirname, '..');
    const indexPath = path.join(root, 'index.html');
    const original = fs.readFileSync(indexPath, 'utf8');
    const updated = versionAssets(original, file => fs.readFileSync(path.join(root, file), 'utf8'));
    if (process.argv.includes('--check')) {
        if (updated.html !== original || !writeAssets(root, updated.assets, true)) {
            console.error('Calculator asset versions are stale. Run npm run assets:calculator.');
            process.exitCode = 1;
        } else console.log(`Verified ${updated.count} calculator asset versions.`);
    } else {
        writeAssets(root, updated.assets, false);
        fs.writeFileSync(indexPath, updated.html);
        console.log(`Updated ${updated.count} calculator asset versions.`);
    }
}
module.exports = { versionAssets, writeAssets };
