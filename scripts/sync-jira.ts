import { syncJiraProject } from "../src/jira/sync.js";

const result = await syncJiraProject();
console.log(result.message);
