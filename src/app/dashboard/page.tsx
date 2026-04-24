import { redirect } from 'next/navigation';

/**
 * Legacy `/dashboard` → now redirects to the Centro de Comando at
 * `/workspace`. This eliminates the "two homes" UX regression (light 2019-ish
 * panel vs. Elite dark cockpit). Conversation history is surfaced inside the
 * ChatSidebar (Historial tab) in the new shell.
 *
 * The legacy light dashboard (stats, risk gauge, quick actions, conversation
 * list) was deleted — its useful bits already live in ChatSidebar + the 4
 * area surfaces. Nothing in the app imports from this route anymore.
 */
export default function Page(): never {
  redirect('/workspace');
}
