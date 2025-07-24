# SSH MCP Server

A Model Context Protocol server for SSH connectivity

This is a TypeScript-based MCP server that provides SSH connectivity functionality. It allows you to manage SSH server connections and execute commands remotely through the MCP protocol.

## Features

### Resources
- List and access SSH server configurations via `ssh://` URIs
- Each SSH server has connection details and metadata
- JSON mime type for structured configuration access
- Sensitive information (passwords/keys) is masked when reading resources

### Tools
- `add_ssh_server` - Add new SSH server configurations
  - Takes host, username, port, and authentication details
  - Supports both password and private key authentication
  - Stores server configuration for later use

- `run_ssh_command` - Execute commands on configured SSH servers
  - Takes server ID and command to execute
  - Returns command output and execution details
  - Configurable timeout (default: 30 seconds)

- `list_ssh_servers` - List all configured SSH servers
  - Shows server details without sensitive information
  - Useful for managing multiple SSH connections

- `remove_ssh_server` - Remove SSH server configurations
  - Takes server ID to remove
  - Cleans up stored configuration

## Development

Install dependencies:
```bash
npm install
```

Build the server:
```bash
npm run build
```

For development with auto-rebuild:
```bash
npm run watch
```

## Installation

To use with Claude Desktop, add the server config:

On MacOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
On Windows: `%APPDATA%/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "ssh-server": {
      "command": "node",
      "args": ["/path/to/ssh-server/build/index.js"]
    }
  }
}
```

## Usage Examples

1. **Add an SSH server with password authentication:**
   ```json
   {
     "name": "My Web Server",
     "host": "192.168.1.100",
     "port": 22,
     "username": "admin",
     "password": "your-password",
     "description": "Production web server"
   }
   ```

2. **Add an SSH server with private key authentication:**
   ```json
   {
     "name": "My Database Server",
     "host": "db.example.com",
     "port": 22,
     "username": "dbadmin",
     "privateKey": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----",
     "description": "Database server"
   }
   ```

3. **Execute a command:**
   ```json
   {
     "serverId": "ssh_1234567890_abcdef123",
     "command": "ls -la /var/log",
     "timeout": 10000
   }
   ```

## Security Notes

- SSH credentials are stored in memory only and are not persisted
- Private keys and passwords are not exposed when reading server resources
- All SSH connections use the ssh2 library with standard security practices
- Command execution is limited by the configured timeout

## Dependencies

- `@modelcontextprotocol/sdk` - MCP SDK for server implementation
- `ssh2` - SSH client library for Node.js
- `zod` - Schema validation library
- `@types/ssh2` - TypeScript definitions for ssh2

### Debugging

Since MCP servers communicate over stdio, debugging can be challenging. We recommend using the [MCP Inspector](https://github.com/modelcontextprotocol/inspector), which is available as a package script:

```bash
npm run inspector
```

The Inspector will provide a URL to access debugging tools in your browser.
