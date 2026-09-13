import {NextResponse,type NextRequest} from 'next/server';
import {isRejectedLocalePage,localeRequestHeaders} from './lib/localization';
export function proxy(request:NextRequest) {
 const requestHeaders=localeRequestHeaders(request.nextUrl.pathname,request.headers);
 // Reject before rendering/streaming: this Next version otherwise emits its
 // blank document error shell for notFound() in a matched locale page.
 // The dedicated page reuses our recovery UI; a rewrite preserves the URL.
 if(isRejectedLocalePage(request.nextUrl.pathname)) {
  const destination=request.nextUrl.clone();
  destination.pathname='/404';
  return NextResponse.rewrite(destination,{status:404,request:{headers:requestHeaders}});
 }
 return NextResponse.next({request:{headers:requestHeaders}});
}
export const config={matcher:['/((?!_next/static|_next/image|assets/|favicon.ico).*)']};
