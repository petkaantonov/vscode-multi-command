import { Command } from "./command";

export class MultiCommand {
    constructor(
        readonly id: string,
        readonly label: string | undefined,
        readonly description: string | undefined,
        readonly interval: number | undefined,
        readonly sequence: Array<Command>,
        readonly languages: Array<string> | undefined,
    ) {}

    public async execute(varContext: any) {
        for (let command of this.sequence) {
            if (command.delayBefore) {
                await delay(command.delayBefore)
            }
            await command.execute();
            await delay(command.delayAfter || this.interval || 0);
        }
        varContext.lastExecuted = Date.now()
    }
}

function delay(ms: number) {
    if (ms > 0) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
