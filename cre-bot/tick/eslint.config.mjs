// eslint.config.mjs — mirrors bot/eslint.config.mjs
import js from '@eslint/js'
import simpleImportSort from 'eslint-plugin-simple-import-sort'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default [
	{
		ignores: ['node_modules', 'coverage', '.cre_build_tmp.js', 'src/entry-point/.cre_build_tmp.js'],
	},

	{
		files: ['**/*.{js,cjs,mjs}'],
		languageOptions: {
			ecmaVersion: 'latest',
			sourceType: 'module',
			globals: { ...globals.node },
		},
		...js.configs.recommended,
	},

	...tseslint.configs.recommended.map((cfg) => ({
		...cfg,
		files: ['**/*.{ts,tsx}'],
		languageOptions: {
			...cfg.languageOptions,
			ecmaVersion: 'latest',
			sourceType: 'module',
			globals: { ...globals.node },
		},
	})),

	{
		files: ['**/*.{js,cjs,mjs,ts,tsx}'],
		plugins: {
			'@typescript-eslint': tseslint.plugin,
			'simple-import-sort': simpleImportSort,
		},
		rules: {
			eqeqeq: ['warn', 'always'],
			'@typescript-eslint/no-unused-vars': [
				'warn',
				{
					argsIgnorePattern: '^_',
					varsIgnorePattern: '^_',
				},
			],
			'simple-import-sort/imports': 'error',
			'simple-import-sort/exports': 'warn',
		},
	},

	{
		files: ['test/**/*.{ts,tsx}'],
		rules: {
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/no-unused-expressions': 'off',
		},
	},
]
