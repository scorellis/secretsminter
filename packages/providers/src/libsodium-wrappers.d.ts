// libsodium-wrappers ships no type declarations. We use it only through the local `SodiumLike`
// interface in github.ts (dynamic import), so an ambient `any` module declaration is sufficient.
declare module "libsodium-wrappers";
