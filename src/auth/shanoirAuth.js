import { UserManager, WebStorageStateStore, InMemoryWebStorage } from 'oidc-client-ts';

export function createShanoirUserManager(
  config,
  { origin = window.location.origin, baseUrl = import.meta.env.BASE_URL } = {}
) {
  return new UserManager({
    authority: config.authority,
    client_id: config.clientId,
    redirect_uri: new URL(baseUrl, origin).href, // 'https://viewer.example/videpe/'
    userStore: new WebStorageStateStore({ store: new InMemoryWebStorage() }),
  });
}
