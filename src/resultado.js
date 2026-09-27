// Capturan una operación y conservan su valor o el error original. Quien llama decide si
// usa un valor por defecto, registra el error o lo propaga; estos helpers no descartan fallas.
// intentar es síncrono; si la operación devuelve una promesa, usar intentarAsync.
export function intentar(operacion) {
  try {
    return { ok: true, valor: operacion() };
  } catch (error) {
    return { ok: false, error };
  }
}

// Para promesas: el await permite capturar tanto excepciones síncronas como rechazos.
export async function intentarAsync(operacion) {
  try {
    return { ok: true, valor: await operacion() };
  } catch (error) {
    return { ok: false, error };
  }
}
