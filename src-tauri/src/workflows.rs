use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowPhase {
    pub label: String,
    pub prompt_template: String,
    pub tools: Option<Vec<String>>,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workflow {
    pub id: String,
    pub label: String,
    pub description: String,
    pub phases: Vec<WorkflowPhase>,
}

pub fn builtin_workflows() -> Vec<Workflow> {
    vec![
        Workflow {
            id: "explore".into(),
            label: "Explore Codebase".into(),
            description: "Analyze and explain a codebase's structure, patterns, and key files.".into(),
            phases: vec![
                WorkflowPhase {
                    label: "Scan structure".into(),
                    prompt_template: "Scan the project structure using `tree` and `search_files`. Identify the build system, key directories, and entry points. Report what you find.\n\nUser request: {{user_input}}".into(),
                    tools: Some(vec!["tree".into(), "search_files".into(), "list_directory".into(), "read_file".into()]),
                    model: Some("fast".into()),
                },
                WorkflowPhase {
                    label: "Read key files".into(),
                    prompt_template: "Based on the project scan results below, read the most important files (config files, main entry points, READMEs). Summarize what each does.\n\nPrevious findings:\n{{previous_result}}".into(),
                    tools: Some(vec!["read_file".into(), "grep".into(), "find_definition".into()]),
                    model: None,
                },
                WorkflowPhase {
                    label: "Summarize architecture".into(),
                    prompt_template: "Based on all findings below, write a clear architecture summary. Include: tech stack, directory structure, key abstractions, data flow, and entry points.\n\nFindings:\n{{previous_result}}".into(),
                    tools: None,
                    model: None,
                },
            ],
        },
        Workflow {
            id: "implement".into(),
            label: "Implement Feature".into(),
            description: "Plan and implement a new feature with exploration, planning, and review.".into(),
            phases: vec![
                WorkflowPhase {
                    label: "Understand request".into(),
                    prompt_template: "Understand the following feature request. Identify what needs to change and what questions remain.\n\nRequest: {{user_input}}".into(),
                    tools: Some(vec!["read_file".into(), "grep".into(), "find_definition".into(), "tree".into(), "search_files".into()]),
                    model: None,
                },
                WorkflowPhase {
                    label: "Plan implementation".into(),
                    prompt_template: "Based on the analysis below, create a detailed implementation plan. List the files to modify, the changes needed, and the order of operations.\n\nAnalysis:\n{{previous_result}}".into(),
                    tools: Some(vec!["read_file".into(), "grep".into(), "find_definition".into()]),
                    model: None,
                },
                WorkflowPhase {
                    label: "Implement changes".into(),
                    prompt_template: "Execute the implementation plan below. Make all necessary changes. Verify each change by reading the file after editing.\n\nPlan:\n{{previous_result}}".into(),
                    tools: None,
                    model: None,
                },
                WorkflowPhase {
                    label: "Review changes".into(),
                    prompt_template: "Review all changes made. Check `git_diff` for what changed. Look for bugs, missing edge cases, or style issues. Summarize the implementation.\n\nImplementation notes:\n{{previous_result}}".into(),
                    tools: Some(vec!["git_diff".into(), "git_status".into(), "read_file".into(), "grep".into()]),
                    model: None,
                },
            ],
        },
        Workflow {
            id: "review".into(),
            label: "Review Changes".into(),
            description: "Review recent code changes for bugs, style issues, and improvements.".into(),
            phases: vec![
                WorkflowPhase {
                    label: "Gather changes".into(),
                    prompt_template: "Review the current state of changes. Run git_diff and git_status. Read the changed files. List all modifications.\n\nUser context: {{user_input}}".into(),
                    tools: Some(vec!["git_diff".into(), "git_status".into(), "git_log".into(), "read_file".into()]),
                    model: Some("fast".into()),
                },
                WorkflowPhase {
                    label: "Analyze for issues".into(),
                    prompt_template: "Analyze the changes below for: bugs, security issues, performance problems, style inconsistencies, missing error handling, and test gaps. Be specific with file paths and line numbers.\n\nChanges:\n{{previous_result}}".into(),
                    tools: Some(vec!["read_file".into(), "grep".into(), "find_definition".into()]),
                    model: None,
                },
                WorkflowPhase {
                    label: "Summary".into(),
                    prompt_template: "Write a concise code review summary based on the analysis below. Organize by severity (critical, warning, suggestion). Include specific file:line references.\n\nAnalysis:\n{{previous_result}}".into(),
                    tools: None,
                    model: None,
                },
            ],
        },
        Workflow {
            id: "fix".into(),
            label: "Fix Bug".into(),
            description: "Diagnose and fix a reported bug.".into(),
            phases: vec![
                WorkflowPhase {
                    label: "Understand the bug".into(),
                    prompt_template: "Understand the following bug report. Search the codebase for relevant code. Identify likely causes.\n\nBug report: {{user_input}}".into(),
                    tools: Some(vec!["grep".into(), "find_definition".into(), "read_file".into(), "search_files".into(), "tree".into()]),
                    model: None,
                },
                WorkflowPhase {
                    label: "Identify root cause".into(),
                    prompt_template: "Based on the investigation below, pinpoint the root cause. Read the specific files and functions involved. Explain why the bug occurs.\n\nInvestigation:\n{{previous_result}}".into(),
                    tools: Some(vec!["read_file".into(), "grep".into(), "find_definition".into()]),
                    model: None,
                },
                WorkflowPhase {
                    label: "Implement fix".into(),
                    prompt_template: "Fix the bug identified below. Make minimal, targeted changes. Verify the fix by reading the modified files.\n\nRoot cause:\n{{previous_result}}".into(),
                    tools: None,
                    model: None,
                },
                WorkflowPhase {
                    label: "Verify".into(),
                    prompt_template: "Verify the fix. Check git_diff to confirm the changes are correct and minimal. Look for any regressions. Summarize what was fixed and why.\n\nFix details:\n{{previous_result}}".into(),
                    tools: Some(vec!["git_diff".into(), "git_status".into(), "read_file".into()]),
                    model: None,
                },
            ],
        },
    ]
}

/// Look up a workflow by ID.
pub fn get_workflow(id: &str) -> Option<Workflow> {
    builtin_workflows().into_iter().find(|w| w.id == id)
}

/// List all available workflows (id, label, description).
pub fn list_workflows() -> Vec<(String, String, String)> {
    builtin_workflows()
        .into_iter()
        .map(|w| (w.id, w.label, w.description))
        .collect()
}
