// Proxy serves this existing recovery UI with HTTP 404, including direct /404
// requests. Do not throw here: matched-route notFound() can lose the SSR shell.
export {default} from '../not-found';
