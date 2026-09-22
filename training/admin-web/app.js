import { AdminApiClient, renderProblemDetails } from './api/client.js';
import { AnalyticsPage } from './pages/analytics.js';
import { AssignmentPage } from './pages/assignments.js';
import { KnowledgePage } from './pages/knowledge.js';
import { LearnerPage } from './pages/learners.js';
import { ScenarioPage } from './pages/scenarios.js';
import { ScoringPage } from './pages/scoring.js';
import { TemplatePage } from './pages/templates.js';
export { AdminApiClient, renderProblemDetails } from './api/client.js';
export { AdminApiProblem, escapeHtml } from './api/client.js';
export { AnalyticsPage, summarizeReview } from './pages/analytics.js';
export { AssignmentPage } from './pages/assignments.js';
export { KnowledgePage } from './pages/knowledge.js';
export { LearnerPage } from './pages/learners.js';
export { ScenarioPage } from './pages/scenarios.js';
export { ScoringPage } from './pages/scoring.js';
export { TemplatePage } from './pages/templates.js';
export { mountAdminApplication, toTemplateSelection, readTemplateFilter, readTemplateRowOp, toTemplateEdit, toAssignmentCreate, toAssignmentTargets, readAssignmentStatusOp, readAssignmentFilter, readLearnerSearch, readLearnerOpen, readLearnerPage, readEvaluationFilter, readEvaluationReplay, readEvaluationPage, toScenarioUpdate, toScenarioDraftPayload, readScenarioOperation } from './browser.js';
export const adminWebSkeleton = {
    application: 'admin-web',
    runtime: 'browser',
    stage: 'bootstrap',
};
export class AdminApplication {
    templates;
    scenarios;
    assignments;
    learners;
    analytics;
    knowledge;
    scoring;
    route = 'templates';
    constructor(client) {
        this.templates = new TemplatePage(client);
        this.scenarios = new ScenarioPage(client);
        this.assignments = new AssignmentPage(client);
        this.learners = new LearnerPage(client);
        this.analytics = new AnalyticsPage(client);
        this.knowledge = new KnowledgePage(client);
        this.scoring = new ScoringPage(client);
    }
    navigate(route) {
        this.route = route;
    }
    get currentRoute() {
        return this.route;
    }
    render() {
        if (this.route === 'scenarios')
            return this.scenarios.render();
        if (this.route === 'assignments')
            return this.assignments.render();
        if (this.route === 'learners')
            return this.learners.render();
        if (this.route === 'analytics')
            return this.analytics.render();
        if (this.route === 'knowledge')
            return this.knowledge.render();
        if (this.route === 'scoring')
            return this.scoring.render();
        return this.templates.render();
    }
}
export async function runAdminMvpFlow(client, input) {
    await client.post(`/admin/scenarios/${input.draftId}/validate`);
    await client.post(`/admin/scenarios/${input.draftId}/publish`);
    await client.post('/admin/assignments', input.assignment);
    await client.get('/admin/evaluations');
}
