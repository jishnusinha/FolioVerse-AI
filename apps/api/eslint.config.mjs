import nodePreset from '@folioverse/shared-config/eslint/node';

export default [...nodePreset(), { ignores: ['dist/**'] }];
