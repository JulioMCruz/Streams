export function ensureEnvVar(
	envVar: string | undefined,
	varName: string
): string {
	if (!envVar) {
		throw new Error(`${varName} is not defined`)
	}
	return envVar
}
