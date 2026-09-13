export type Locale = 'es' | 'en';
export function isLocale(value: string): value is Locale { return value === 'es' || value === 'en'; }
// Values faithfully inherited from the linked design. Publication approval is a separate gate.
export const festival = {
  officialName: 'ELEMENTA', editionName: 'ORIGINS 2027',
  festivalStartDate: '2027-02-19', festivalEndDate: '2027-02-20',
  announcementAt: '2026-10-01T00:00:00-05:00', announcementTimeZone: 'America/Panama',
  venue: null, organizer: null, ticketUrl: null, ticketStatus: 'unreleased',
} as const;
export const copy = {
 es: {
  essence:'Un festival de música house con raíces en Playa Venao.', festivalLabel:'EL FESTIVAL', dates:'19–20 de febrero de 2027', location:'Playa Venao, Panamá',
  countdown:'El lineup y las entradas llegan en', units:['Días','Horas','Minutos','Segundos'], releaseDate:'1 de octubre de 2026',
  releaseTime:'1 de octubre de 2026, 00:00, hora de Panamá (UTC−5).', pending:'Próximamente, todos los detalles.', releaseHeading:'Lineup y entradas',
  description:'ELEMENTA ORIGINS 2027 en Playa Venao, Panamá. 19–20 de febrero. Lineup, entradas, itinerario e información del festival: 1 de octubre de 2026.',
  language:'Idioma', credit:'Fotografía', pause:'Pausar movimiento', resume:'Activar movimiento',
  pauseLabel:'Pausar movimiento y actualizaciones del contador', resumeLabel:'Reanudar movimiento y contador',
  cta:'Quiero recibir novedades', signupTitle:'Sigue cerca de ELEMENTA.', intro:'Recibe el lineup, la apertura de entradas y las novedades del festival en tu correo.',
  email:'Correo electrónico', consent:'Me interesa recibir novedades de ELEMENTA sobre el lineup y las entradas.',
  privacy:'La suscripción todavía no está conectada. No se envía ni se guarda tu dirección.',
  submit:'Unirme a la lista', close:'Cerrar', result:'Esta es una vista previa. Tu correo no se ha enviado ni guardado.',
  noScript:'Activa JavaScript para abrir la vista previa de suscripción.', back:'Volver a ELEMENTA',
 },
 en: {
  essence:'A house music festival rooted in Playa Venao.', festivalLabel:'THE FESTIVAL', dates:'February 19–20, 2027', location:'Playa Venao, Panama',
  countdown:'Lineup & tickets release in', units:['Days','Hours','Minutes','Seconds'], releaseDate:'October 1, 2026',
  releaseTime:'October 1, 2026, 00:00, Panama time (UTC−5).', pending:'Full details coming soon.', releaseHeading:'Lineup & tickets',
  description:'ELEMENTA ORIGINS 2027 in Playa Venao, Panama. February 19–20. Lineup, tickets, itinerary and festival information: October 1, 2026.',
  language:'Language', credit:'Photography', pause:'Pause motion', resume:'Enable motion',
  pauseLabel:'Pause motion and countdown updates', resumeLabel:'Resume motion and countdown',
  cta:'Keep me updated', signupTitle:'Stay close to ELEMENTA.', intro:'Get the lineup, ticket release and festival news in your inbox.',
  email:'Email address', consent:'I am interested in ELEMENTA lineup and ticket updates.',
  privacy:'Email signup is not connected yet. Your address is not sent or saved.',
  submit:'Join the list', close:'Close', result:'This is a signup preview. Your email has not been sent or saved.',
  noScript:'Enable JavaScript to open the signup preview.', back:'Back to ELEMENTA',
 }
} as const;
