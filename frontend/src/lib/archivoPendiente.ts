// El Excel que Importar Excel le pasa a Cargar obra («Cargarlo en Cargar obra»): vive en memoria, nada más.
// Cargar obra lo toma una sola vez al abrir y lo revisa como si Sol lo hubiera elegido.

let pendiente: File | null = null

export function dejarArchivoParaCargarObra(f: File) {
  pendiente = f
}

export function tomarArchivoParaCargarObra(): File | null {
  const f = pendiente
  pendiente = null
  return f
}
