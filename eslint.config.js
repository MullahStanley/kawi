import firebaseRulesPlugin from '@firebase/eslint-plugin-security-rules';

export default [
  {
    ignores: ['dist/**/*', 'node_modules/**/*', 'expo-mobile/**/*']
  },
  firebaseRulesPlugin.configs['flat/recommended']
];
