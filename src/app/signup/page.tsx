import { redirect } from 'next/navigation';

/**
 * /signup — redirige a /login?mode=signup.
 *
 * El formulario de creación de cuenta vive en /login (modo dual con toggle
 * "Iniciar sesión / Crear cuenta" cableado a authClient.signUp.email). Esta
 * página duplicaba ese formulario al 100%; mantener dos implementaciones del
 * mismo flujo de auth es deuda — se conserva la ruta solo por compatibilidad
 * de enlaces externos.
 */
export default function SignupPage() {
  redirect('/login?mode=signup');
}
