import { createSignupHandler } from '@/lib/signup';
import { saveSubscriber } from '@/lib/subscribers';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  return createSignupHandler(saveSubscriber, process.env.SIGNUP_ALLOWED_ORIGIN)(request);
}
