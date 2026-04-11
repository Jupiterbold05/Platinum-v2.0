var commands = [];

function cmd(info, func) {
    var data = info;
    data.function = func;
    if (!data.dontAddCommandList) data.dontAddCommandList = false;
    if (!info.desc) info.desc = '';
    if (!data.fromMe) data.fromMe = false;
    if (!info.category) data.category = 'misc';
    if (!info.filename) data.filename = "Not Provided";
    commands.push(data);
    return data;
}

// Function to detect regex-based commands
async function checkRegexCommands(conn, m) {
    let text = m.body || "";

    for (let command of commands) {
        if (command.pattern && command.pattern instanceof RegExp) {
            let match = text.match(command.pattern);
            if (match) {
                try {
                    await command.function(conn, m, match);
                } catch (e) {
                    console.error(`Error in regex command: ${e}`);
                }
            }
        }
    }
}

module.exports = {
    cmd,
    AddCommand: cmd,
    Function: cmd,
    Module: cmd,
    commands,
    checkRegexCommands
};