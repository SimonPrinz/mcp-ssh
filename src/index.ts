#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Client, ConnectConfig } from 'ssh2';
import { z } from 'zod';
import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

interface SSHServer {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  description?: string;
}

// Get the directory where the script is located
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SERVERS_DIR = join(__dirname, '..', 'servers');

const SSHServerSchema = z.object({
  name: z.string().describe("Display name for the SSH server"),
  host: z.string().describe("SSH server hostname or IP address"),
  port: z.number().min(1).max(65535).default(22).describe("SSH server port"),
  username: z.string().describe("SSH username"),
  password: z.string().optional().describe("SSH password (if not using key auth)"),
  privateKey: z.string().optional().describe("SSH private key content (if not using password auth)"),
  description: z.string().optional().describe("Optional description of the server")
});

const RunCommandSchema = z.object({
  serverId: z.string().describe("ID of the SSH server to run the command on"),
  command: z.string().describe("Command to execute on the SSH server"),
  timeout: z.number().min(1000).max(300000).default(30000).describe("Command timeout in milliseconds (default: 30s)")
});

// Utility functions for server persistence
async function ensureServersDirectory(): Promise<void> {
  try {
    await fs.access(SERVERS_DIR);
  } catch {
    await fs.mkdir(SERVERS_DIR, { recursive: true });
  }
}

async function saveServerToFile(server: SSHServer): Promise<void> {
  await ensureServersDirectory();
  const filePath = join(SERVERS_DIR, `${server.id}.json`);
  await fs.writeFile(filePath, JSON.stringify(server, null, 2), 'utf8');
}

async function loadServerFromFile(serverId: string): Promise<SSHServer | null> {
  try {
    const filePath = join(SERVERS_DIR, `${serverId}.json`);
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data) as SSHServer;
  } catch {
    return null;
  }
}

async function deleteServerFile(serverId: string): Promise<void> {
  try {
    const filePath = join(SERVERS_DIR, `${serverId}.json`);
    await fs.unlink(filePath);
  } catch {
    // File doesn't exist or couldn't be deleted, ignore
  }
}

async function getAllServers(): Promise<SSHServer[]> {
  try {
    await ensureServersDirectory();
    const files = await fs.readdir(SERVERS_DIR);
    const jsonFiles = files.filter(file => file.endsWith('.json'));
    const servers: SSHServer[] = [];
    
    for (const file of jsonFiles) {
      try {
        const filePath = join(SERVERS_DIR, file);
        const data = await fs.readFile(filePath, 'utf8');
        const server = JSON.parse(data) as SSHServer;
        servers.push(server);
      } catch (error) {
        console.error(`Failed to load server from ${file}:`, error);
      }
    }
    
    return servers;
  } catch (error) {
    console.error('Failed to load servers:', error);
    return [];
  }
}

async function getServerById(serverId: string): Promise<SSHServer | null> {
  return await loadServerFromFile(serverId);
}

const server = new Server(
  {
    name: "ssh-server",
    version: "0.1.0",
  },
  {
    capabilities: {
      resources: {},
      tools: {},
    },
  }
);

async function executeSSHCommand(serverConfig: SSHServer, command: string, timeout: number = 30000): Promise<string> {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let output = '';
    let errorOutput = '';
    
    const timeoutId = setTimeout(() => {
      conn.end();
      reject(new Error(`Command timed out after ${timeout}ms`));
    }, timeout);

    conn.on('ready', () => {
      conn.exec(command, (err: Error | undefined, stream: any) => {
        if (err) {
          clearTimeout(timeoutId);
          conn.end();
          reject(err);
          return;
        }

        stream.on('close', (code: number) => {
          clearTimeout(timeoutId);
          conn.end();
          
          if (code === 0) {
            resolve(output);
          } else {
            reject(new Error(`Command failed with exit code ${code}${errorOutput ? ': ' + errorOutput : ''}`));
          }
        }).on('data', (data: Buffer) => {
          output += data.toString();
        }).stderr.on('data', (data: Buffer) => {
          errorOutput += data.toString();
        });
      });
    }).on('error', (err: Error) => {
      clearTimeout(timeoutId);
      reject(err);
    });

    const connectConfig: ConnectConfig = {
      host: serverConfig.host,
      port: serverConfig.port,
      username: serverConfig.username,
    };

    if (serverConfig.password) {
      connectConfig.password = serverConfig.password;
    } else if (serverConfig.privateKey) {
      connectConfig.privateKey = serverConfig.privateKey;
    } else {
      reject(new Error('Either password or privateKey must be provided'));
      return;
    }

    conn.connect(connectConfig);
  });
}

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  const servers = await getAllServers();
  return {
    resources: servers.map((server) => ({
      uri: `ssh:///${server.id}`,
      mimeType: "application/json",
      name: server.name,
      description: `SSH Server: ${server.name} (${server.username}@${server.host}:${server.port})${server.description ? ' - ' + server.description : ''}`
    }))
  };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const url = new URL(request.params.uri);
  const id = url.pathname.replace(/^\//, '');
  const sshServer = await getServerById(id);

  if (!sshServer) {
    throw new Error(`SSH server ${id} not found`);
  }

  const safeConfig = {
    id: sshServer.id,
    name: sshServer.name,
    host: sshServer.host,
    port: sshServer.port,
    username: sshServer.username,
    description: sshServer.description,
    hasPassword: !!sshServer.password,
    hasPrivateKey: !!sshServer.privateKey
  };

  return {
    contents: [{
      uri: request.params.uri,
      mimeType: "application/json",
      text: JSON.stringify(safeConfig, null, 2)
    }]
  };
});

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "add_ssh_server",
        description: "Add a new SSH server configuration",
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Display name for the SSH server"
            },
            host: {
              type: "string",
              description: "SSH server hostname or IP address"
            },
            port: {
              type: "number",
              description: "SSH server port (default: 22)",
              default: 22
            },
            username: {
              type: "string",
              description: "SSH username"
            },
            password: {
              type: "string",
              description: "SSH password (if not using key auth)"
            },
            privateKey: {
              type: "string",
              description: "SSH private key content (if not using password auth)"
            },
            description: {
              type: "string",
              description: "Optional description of the server"
            }
          },
          required: ["name", "host", "username"]
        }
      },
      {
        name: "run_ssh_command",
        description: "Execute a command on an SSH server",
        inputSchema: {
          type: "object",
          properties: {
            serverId: {
              type: "string",
              description: "ID of the SSH server to run the command on"
            },
            command: {
              type: "string",
              description: "Command to execute on the SSH server"
            },
            timeout: {
              type: "number",
              description: "Command timeout in milliseconds (default: 30000)",
              default: 30000
            }
          },
          required: ["serverId", "command"]
        }
      },
      {
        name: "list_ssh_servers",
        description: "List all configured SSH servers",
        inputSchema: {
          type: "object",
          properties: {}
        }
      },
      {
        name: "remove_ssh_server",
        description: "Remove an SSH server configuration",
        inputSchema: {
          type: "object",
          properties: {
            serverId: {
              type: "string",
              description: "ID of the SSH server to remove"
            }
          },
          required: ["serverId"]
        }
      }
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  switch (request.params.name) {
    case "add_ssh_server": {
      try {
        const args = SSHServerSchema.parse(request.params.arguments);
        
        if (!args.password && !args.privateKey) {
          throw new Error("Either password or privateKey must be provided");
        }
        
        const id = `ssh_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const sshServer: SSHServer = {
          id,
          name: args.name,
          host: args.host,
          port: args.port,
          username: args.username,
          password: args.password,
          privateKey: args.privateKey,
          description: args.description
        };
        
        // Save server to file (no in-memory storage)
        await saveServerToFile(sshServer);
        
        return {
          content: [{
            type: "text",
            text: `Successfully added SSH server "${args.name}" with ID: ${id}\nHost: ${args.host}:${args.port}\nUsername: ${args.username}\nSaved to: servers/${id}.json`
          }]
        };
      } catch (error) {
        throw new Error(`Failed to add SSH server: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    case "run_ssh_command": {
      try {
        const args = RunCommandSchema.parse(request.params.arguments);
        const sshServer = await getServerById(args.serverId);
        
        if (!sshServer) {
          throw new Error(`SSH server with ID ${args.serverId} not found`);
        }
        
        const output = await executeSSHCommand(sshServer, args.command, args.timeout);
        
        return {
          content: [{
            type: "text",
            text: `Command executed on ${sshServer.name} (${sshServer.host}):\n$ ${args.command}\n\n${output}`
          }]
        };
      } catch (error) {
        throw new Error(`Failed to execute SSH command: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    case "list_ssh_servers": {
      const servers = await getAllServers();
      const serverList = servers.map(server => ({
        id: server.id,
        name: server.name,
        host: server.host,
        port: server.port,
        username: server.username,
        description: server.description
      }));
      
      return {
        content: [{
          type: "text",
          text: serverList.length > 0
            ? `Configured SSH Servers:\n${JSON.stringify(serverList, null, 2)}`
            : "No SSH servers configured"
        }]
      };
    }

    case "remove_ssh_server": {
      const serverId = String(request.params.arguments?.serverId);
      if (!serverId) {
        throw new Error("serverId is required");
      }
      
      const sshServer = await getServerById(serverId);
      if (!sshServer) {
        throw new Error(`SSH server with ID ${serverId} not found`);
      }
      
      // Delete server file
      await deleteServerFile(serverId);
      
      return {
        content: [{
          type: "text",
          text: `Successfully removed SSH server "${sshServer.name}" (ID: ${serverId})\nDeleted file: servers/${serverId}.json`
        }]
      };
    }

    default:
      throw new Error(`Unknown tool: ${request.params.name}`);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("SSH MCP server running on stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
