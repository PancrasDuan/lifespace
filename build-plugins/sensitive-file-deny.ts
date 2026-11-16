// Shared by the product dev server and the loopback review harness. Keep local
// credentials and private build/runtime state outside static serving boundaries.
export function sensitiveFileDeny(projectRoot: string, extra: string[] = []) {
  return ['.env', '.env.*', '*.{crt,pem,key,p12,pfx,cer,der}', '.npmrc', '.yarnrc.yml', '**/.git/**',
    '**/.dev.vars*', '**/.cache/**', '**/.aws/**', '**/.impeccable/**', '**/DESIGN.md', `${projectRoot}/.codex/**`, '**/dist/lifespace/**', ...extra]
}
