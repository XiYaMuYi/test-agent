/**
 * Reserved migration slot for persona templates.
 *
 * This migration is intentionally a no-op. The original plan was to create a
 * standalone persona_templates table here. The C-first dual-track redesign
 * (see docs/architecture/contracts/c-first-dual-track-contract.md) folds
 * personal persona templates into training_template with scope='personal',
 * delivered by migration 0015. The id stays reserved and registered so the
 * append-only migration ledger remains linear for every environment that may
 * already have recorded 0014.
 */
export const personaTemplatesMigration = {
    id: '0014_persona_templates',
    description: 'Reserved no-op. Personal persona templates are delivered by 0015 as training_template(scope=personal).',
    async up() {
        // Intentionally empty: superseded by 0015_c_first_dual_track.
    },
    async down() {
        // Intentionally empty: nothing was created.
    },
};
