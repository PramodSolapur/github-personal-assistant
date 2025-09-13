import z from "zod"
import { tool } from "@langchain/core/tools"
import { Octokit } from "octokit"
import path from "node:path"
import url from "node:url"
import simpleGit from "simple-git"

const __filename = url.fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const octokit = new Octokit({
    auth: process.env.GITHUB_ACCESS_TOKEN,
})

const getOwner = async () => {
    const { data } = await octokit.rest.users.getAuthenticated()
    return data.login
}

const getRepoDetails = async ({ owner, repo }) => {
    const { data } = await octokit.rest.repos.get({
        owner,
        repo,
    })

    return data
}

export const createGitRepository = tool(
    async function (params) {
        try {
            const { repoName, description } = params
            const response = await octokit.request("POST /user/repos", {
                name: repoName,
                description,
                homepage: "https://github.com",
                private: false,
                auto_init: false, // README.md file will not be added
                headers: {
                    "X-GitHub-Api-Version": "2022-11-28",
                },
            })
            return (
                "git repository created successfully!! " +
                response.data.html_url
            )
        } catch (error) {
            console.error("ERROR: ", error)
        }

        return "Not able to create git repository, try again later"
    },
    {
        name: "create-git-respository",
        description: "Call the tool to create a new git repository",
        schema: z.object({
            repoName: z
                .string()
                .describe("Name of the git repository to create"),
            description: z
                .string()
                .describe("description of the git repository to create"),
        }),
    }
)

export const deleteRepository = tool(
    async function (params) {
        try {
            const { repoName } = params
            const owner = await getOwner()
            const response = await octokit.rest.repos.delete({
                owner,
                repo: repoName,
            })
            if (response?.status === 204) {
                return "Repository deleted successfully!"
            }
        } catch (error) {
            console.error("ERROR: ", error)
        }

        return "Not able to delete the repository"
    },
    {
        name: "delete-git-respository",
        description: "Call the tool to delete a created git repository",
        schema: z.object({
            repoName: z
                .string()
                .describe("Name of the git repository to delete"),
        }),
    }
)

export const getRepository = tool(
    async function (params) {
        try {
            const { repoName } = params
            const owner = await getOwner()

            const data = await getRepoDetails({
                owner,
                repo: repoName,
            })

            const repoDetails = {
                id: data.id,
                name: data.name,
                description: data.description,
                owner: data.owner.login,
                private: data.private,
                url: data.html_url,
                createdAt: data.created_at,
                avatarUrl: data.owner.avatar_url,
                userViewType: data.owner.user_view_type,
            }

            return JSON.stringify(repoDetails)
        } catch (error) {
            console.error("ERROR: ", error)
        }

        return "Not able to fetch more details of the repository"
    },
    {
        name: "get-repository-details",
        description: "Call to get more details of the created repository",
        schema: z.object({
            repoName: z
                .string()
                .describe("Name of the git repository to fetch more details"),
        }),
    }
)

export const gitPush = tool(
    async function (params) {
        try {
            const { projectName, repoName, commitMessage } = params

            const owner = await getOwner()

            const data = await getRepoDetails({
                owner,
                repo: repoName,
            })

            const projectPath = path.join(__dirname, `../${projectName}`)

            // Use repo URL with PAT for authentication
            const authedUrl = data.html_url.replace(
                "https://",
                `https://${process.env.GITHUB_ACCESS_TOKEN}@`
            )

            const git = simpleGit(projectPath)

            // 1. Init git
            await git.init()

            // 2. Add files
            await git.add("./*")

            // 3. Commit files
            await git.commit(commitMessage)

            // 4. Switch/create 'main' safely
            const branches = await git.branchLocal()

            if (branches.all.includes("main")) {
                await git.checkout("main")
            } else {
                await git.checkoutLocalBranch("main") // create a new local branch called main (and switch to it).
            }

            // 5. Add remote safely
            const remotes = await git.getRemotes(true)

            if (remotes.find((r) => r.name === "origin")) {
                await git.removeRemote("origin")
            }

            await git.addRemote("origin", authedUrl)

            // 6. Pull remote changes if any
            try {
                // --rebase → instead of creating a merge commit, Git replays your local commits on top of the remote branch’s commits.
                await git.pull("origin", "main", { "--rebase": "true" })
            } catch (pullErr) {
                console.warn(
                    "⚠️ Pull failed (probably empty repo):",
                    pullErr.message
                )
            }

            // 7. Push and set upstream
            await git.push(["-u", "origin", "main"])

            return "✅ Files pushed successfully!"
        } catch (error) {
            console.error("ERROR: ", error)
        }

        return "❌ Git push operation failed"
    },
    {
        name: "git-push-files",
        description: "Call to push files to the provided repo url",
        schema: z.object({
            repoName: z.string().describe("git repo name to push the files"),
            commitMessage: z
                .string()
                .describe("commit message to push the files"),
            projectName: z
                .string()
                .describe("project name to push files to git repository"),
        }),
    }
)

export const gitCloneRepository = tool(
    async function (params) {
        try {
            const { repoName } = params
            const owner = await getOwner()
            const data = await getRepoDetails({
                owner,
                repo: repoName,
            })

            const cloneUrl = data.clone_url
            const localPath = "your local file path"

            const git = simpleGit()

            await git.clone(cloneUrl, localPath)

            return `✅ Repo ${owner}/${repoName} cloned into ${localPath}`
        } catch (error) {
            console.error("ERROR: ", error)
        }

        return "repo cloning is failed"
    },
    {
        name: "clone-git-repository",
        description: "Call to clone remote repo into local",
        schema: z.object({
            repoName: z.string().describe("git repo name to clone"),
        }),
    }
)

export const getCommitsByRepoName = tool(
    async function (params) {
        try {
            const { repoName } = params
            const owner = await getOwner()
            const { data } = await octokit.rest.repos.listCommits({
                owner,
                repo: repoName,
                per_page: 10, // // number of commits per page (max 100)
                page: 1, // pagination (start at page 1)
            })

            const commitMessages = data.map((commit) => {
                return {
                    commitId: commit.node_id,
                    sha: commit.sha,
                    message: commit.commit.message,
                    committerName: commit.commit.committer.name,
                    date: commit.commit.committer.date,
                }
            })

            return JSON.stringify(commitMessages)
        } catch (error) {
            console.error("ERROR: ", error)
        }

        return "Not able to fetch commit details"
    },
    {
        name: "get-git-commits-by-repo-name",
        description:
            "Call to fetch all the git commits for a provided repo name",
        schema: z.object({
            repoName: z.string().describe("git repo name to fetch commits"),
        }),
    }
)

export const createOrUpdateGitFile = tool(
    async function (params) {
        try {
            const { fileName, repoName } = params
            const owner = await getOwner()
            const response =
                await octokit.rest.repos.createOrUpdateFileContents({
                    owner,
                    repo: repoName,
                    message: "add hello.txt",
                    content: Buffer.from("Hello from octokit!!").toString(
                        "base64"
                    ),
                    path: fileName, // creates hello.txt in repo root
                })
            return (
                "File added successfully!. " +
                JSON.stringify({ url: response.url })
            )
        } catch (error) {
            console.error("ERROR: ", error)
        }

        return "Neither file created or updated"
    },
    {
        name: "create-or-update-file",
        description: "Call to create or update file in the git repo",
        schema: z.object({
            fileName: z
                .string()
                .describe("file name to create or update in git"),
            repoName: z
                .string()
                .describe("git repo name to create or update a file"),
        }),
    }
)

export const updateRepository = tool(
    async function (params) {
        try {
            const { repoName, description, visibility } = params
            const owner = await getOwner()
            const response = await octokit.rest.repos.update({
                owner,
                repo: repoName, // exisiting repo name. github don't allow to rename a repo
                description,
                visibility,
                private: visibility === "private" ? true : false,
            })
            return "Git repository updated successfully!"
        } catch (error) {
            console.error("ERROR: ", error)
        }

        return "Not able to update the repository"
    },
    {
        name: "Update-git-repository",
        description: "Call to update an exisiting git repository",
        schema: z.object({
            description: z
                .string()
                .describe("description of the repository")
                .optional(),
            repoName: z.string().describe("git repo name to update"),
            visibility: z
                .enum(["public", "private", "internal"])
                .describe("Visibility of the repository")
                .optional(),
        }),
    }
)
