import * as assert from 'assert';

import { assessCommandToolRisk } from '../servers/commandToolRisk';
import type { CommandRiskContext } from '../servers/commandRiskTypes';

const BASE_OPTIONS = {
    commandPath: '.',
    profileId: 'bash',
    shellKind: 'posix' as const,
    toolName: 'execute_command' as const
};

function assess(command: string, riskContext: CommandRiskContext = {}) {
    return assessCommandToolRisk({
        ...BASE_OPTIONS,
        command,
        riskContext
    }).assessment;
}

suite('Command approval relaxation', () => {
    test('command substitution requires confirmation by default', () => {
        const assessment = assess('echo $(git rev-parse HEAD)');
        assert.strictEqual(assessment.level, 'requires_confirmation');
    });

    test('autoApproveConfirmation downgrades command substitution to allowed', () => {
        const assessment = assess('echo $(git rev-parse HEAD)', { autoApproveConfirmation: true });
        assert.strictEqual(assessment.level, 'allowed');
        assert.deepStrictEqual(assessment.reasons, []);
    });

    test('autoApproveConfirmation downgrades interpreter eval to allowed', () => {
        const assessment = assess('node -e "console.log(1)"', { autoApproveConfirmation: true });
        assert.strictEqual(assessment.level, 'allowed');
    });

    test('allowRules exempt matching commands only', () => {
        const riskContext: CommandRiskContext = { allowRules: ['git rev-parse'] };
        assert.strictEqual(assess('echo $(git rev-parse HEAD)', riskContext).level, 'allowed');
        assert.strictEqual(assess('node -e "console.log(1)"', riskContext).level, 'requires_confirmation');
    });

    test('allowRules matching is case-insensitive with collapsed whitespace', () => {
        const riskContext: CommandRiskContext = { allowRules: ['Node  -E'] };
        assert.strictEqual(assess('node -e "1"', riskContext).level, 'allowed');
    });

    test('deny rules still win over allow rules', () => {
        const riskContext: CommandRiskContext = {
            allowRules: ['git push'],
            denyRules: ['git push']
        };
        assert.strictEqual(assess('git push origin main', riskContext).level, 'blocked');
    });

    test('hard-blocked commands stay blocked under autoApproveConfirmation', () => {
        const assessment = assess('sudo rm -rf /', { autoApproveConfirmation: true });
        assert.strictEqual(assessment.level, 'blocked');
    });

    test('clean commands stay allowed without any relaxation', () => {
        const assessment = assess('git status --short');
        assert.strictEqual(assessment.level, 'allowed');
    });
});
