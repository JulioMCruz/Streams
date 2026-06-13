// eslint.config.js
import js from '@eslint/js'
import prettier from 'eslint-plugin-prettier'
import simpleImportSort from 'eslint-plugin-simple-import-sort'
import unusedImports from 'eslint-plugin-unused-imports'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default [
	{
		ignores: [
			'node_modules',
			'artifacts',
			'cache',
			'coverage',
			'deployments',
			'assets'
		]
	},

	{
		files: ['**/*.{js,cjs,mjs}'],
		languageOptions: {
			ecmaVersion: 'latest',
			sourceType: 'module',
			globals: { ...globals.node }
		},
		...js.configs.recommended
	},

	...tseslint.configs.recommended.map(cfg => ({
		...cfg,
		files: ['**/*.{ts,tsx}'],
		languageOptions: {
			...cfg.languageOptions,
			ecmaVersion: 'latest',
			sourceType: 'module',
			globals: { ...globals.node }
		}
	})),

	{
		files: ['**/*.{js,cjs,mjs,ts,tsx}'],
		plugins: {
			'@typescript-eslint': tseslint.plugin,
			'simple-import-sort': simpleImportSort,
			'unused-imports': unusedImports,
			prettier
		},
		rules: {
			eqeqeq: ['warn', 'always'],

			'@typescript-eslint/no-unused-vars': [
				'warn',
				{
					argsIgnorePattern: '^_',
					varsIgnorePattern: '^_'
				}
			],
			'simple-import-sort/imports': 'error',
			'simple-import-sort/exports': 'warn',

			'unused-imports/no-unused-imports': 'warn',
			'unused-imports/no-unused-vars': [
				'warn',
				{
					vars: 'all',
					args: 'after-used',
					argsIgnorePattern: '^_',
					varsIgnorePattern: '^_'
				}
			],

			'prettier/prettier': 'warn'
		}
	},

	{
		files: ['test/**/*.{ts,tsx}'],
		rules: {
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/no-unused-expressions': 'off'
		}
	}
]
