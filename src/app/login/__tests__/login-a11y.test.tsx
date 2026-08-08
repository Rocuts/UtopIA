// ---------------------------------------------------------------------------
// /login — nombre accesible de los campos y honestidad de los controles
// ---------------------------------------------------------------------------
// TRES DEFECTOS QUE ESTE TEST FIJA (auditoria 2026-08):
//
//  1. Los <label> eran hermanos del <input>, sin `htmlFor`, y los <input> no
//     tenian `id`. Resultado: nombre accesible VACIO. Un lector de pantalla
//     anuncia "cuadro de edicion" sin decir cual, y hacer clic en la etiqueta
//     no enfoca el campo. Es la pantalla de entrada al producto.
//  2. "SSO empresarial" y "Llave de acceso" eran <button> sin `onClick`:
//     enfocables, con hover, y al pulsarlos no pasaba absolutamente nada. Un
//     control muerto que se ve vivo es peor que uno ausente — el usuario cree
//     que fallo su cuenta.
//  3. `rememberMe` tenia estado y checkbox, pero el valor no viajaba a ninguna
//     parte: la casilla no hacia nada.
//
// El render es SSR estatico (`renderToStaticMarkup`) porque el proyecto no
// tiene jsdom ni testing-library; alcanza de sobra para verificar la relacion
// label/input y los atributos de los controles, que es markup puro.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const searchParamsRef = vi.hoisted(() => ({ value: '' }));
const signInEmail = vi.hoisted(() =>
  vi.fn(async (_args: Record<string, unknown>) => ({ error: null })),
);
const signUpEmail = vi.hoisted(() =>
  vi.fn(async (_args: Record<string, unknown>) => ({ error: null })),
);

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(searchParamsRef.value),
}));

vi.mock('@/lib/auth/client', () => ({
  authClient: {
    signIn: { email: signInEmail },
    signUp: { email: signUpEmail },
  },
}));

import LoginPage, { signInWithCredentials } from '../page';

/** Ids declarados por los `for=` presentes en el markup. */
function labelTargets(html: string): string[] {
  return [...html.matchAll(/<label[^>]*\sfor="([^"]+)"/g)].map((m) => m[1]);
}

/** Todas las etiquetas `<input ...>` del markup. */
function inputTags(html: string): string[] {
  return [...html.matchAll(/<input\b[^>]*>/g)].map((m) => m[0]);
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? m[1] : null;
}

beforeEach(() => {
  searchParamsRef.value = '';
  signInEmail.mockClear();
  signUpEmail.mockClear();
});

describe('nombre accesible de los campos', () => {
  it('modo login: cada input esta asociado a un label por id/for', () => {
    const html = renderToStaticMarkup(<LoginPage />);
    const targets = labelTargets(html);

    for (const tag of inputTags(html)) {
      const id = attr(tag, 'id');
      expect(id, `input sin id: ${tag}`).toBeTruthy();
      expect(targets, `ningun <label for> apunta a "${id}"`).toContain(id!);
    }
  });

  it('modo signup: el campo de nombre tambien queda asociado', () => {
    searchParamsRef.value = 'mode=signup';
    const html = renderToStaticMarkup(<LoginPage />);
    const targets = labelTargets(html);

    const tags = inputTags(html);
    // name + email + password
    expect(tags.length).toBeGreaterThanOrEqual(3);
    for (const tag of tags) {
      const id = attr(tag, 'id');
      expect(id, `input sin id: ${tag}`).toBeTruthy();
      expect(targets).toContain(id!);
    }
  });
});

describe('controles sin implementacion', () => {
  it('SSO empresarial y Llave de acceso estan desactivados de forma visible', () => {
    const html = renderToStaticMarkup(<LoginPage />);

    const buttons = [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map((m) => m[0]);
    const sso = buttons.find((b) => b.includes('SSO empresarial'));
    const passkey = buttons.find((b) => b.includes('Llave de acceso'));

    expect(sso, 'no se encontro el boton de SSO').toBeTruthy();
    expect(passkey, 'no se encontro el boton de passkey').toBeTruthy();

    for (const btn of [sso!, passkey!]) {
      expect(btn).toMatch(/\sdisabled(=""|\s|>)/);
      expect(attr(btn, 'aria-disabled')).toBe('true');
      // Explicacion legible, no solo el atributo.
      expect(attr(btn, 'title')).toMatch(/pr[oó]ximamente/i);
    }
  });
});

describe('Recordarme', () => {
  it('el valor de la casilla viaja al cliente de autenticacion', async () => {
    await signInWithCredentials({ email: 'a@b.co', password: 'x', rememberMe: false });
    expect(signInEmail).toHaveBeenCalledWith({
      email: 'a@b.co',
      password: 'x',
      rememberMe: false,
    });

    signInEmail.mockClear();
    await signInWithCredentials({ email: 'a@b.co', password: 'x', rememberMe: true });
    expect(signInEmail.mock.calls[0][0]).toMatchObject({ rememberMe: true });
  });
});
