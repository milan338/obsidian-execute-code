import {ChildProcessWithoutNullStreams, spawn} from "child_process";
import {Outputter} from "src/Outputter";
import {ExecutorSettings} from "src/settings/Settings";
import AsyncExecutor from "./AsyncExecutor";


export default class PythonExecutor extends AsyncExecutor {

	process: ChildProcessWithoutNullStreams

	constructor(settings: ExecutorSettings, file: string) {
		super(file, "js");

		const args = settings.nodeArgs ? settings.nodeArgs.split(" ") : [];

		args.unshift(`-e`, `require("repl").start({prompt: "", preview: false, ignoreUndefined: true}).on("exit", ()=>process.exit())`);

		this.process = spawn(settings.nodePath, args);
		
		this.process.on("close", () => this.emit("close"));
		
		this.process.on("error", (err) => {
			this.notifyError(settings.nodePath, args.join(" "), "", err, undefined, "Error launching NodeJS process: " + err);
			this.stop();
		});

		//send a newline so that the intro message won't be buffered
		this.dismissIntroMessage().then(() => {/* do nothing */});
	}

	/**
	 * Close the runtime.
	 * @returns A promise that resolves once the runtime is fully closed
	 */
	stop(): Promise<void> {
		return new Promise((resolve, reject) => {
			this.process.on("close", () => {
				resolve();
			});
			this.process.kill();
			this.process = null;
		});
	}

	/**
	 * Writes a single newline to ensure that the stdin is set up correctly.
	 */
	async dismissIntroMessage() {
		this.process.stdin.write("\n");
	}

	/**
	 * Run some NodeJS code
	 * @param code code to run
	 * @param outputter outputter to use
	 * @param cmd Not used
	 * @param cmdArgs Not used
	 * @param ext Not used
	 * @returns A promise that resolves once the code is done running
	 */
	async run(code: string, outputter: Outputter, cmd: string, cmdArgs: string, ext: string) {

		outputter.queueBlock();

		return this.addJobToQueue((resolve, reject) => {
			if(this.process === null) return resolve();
			
			const finishSigil = `SIGIL_BLOCK_DONE${Math.random()}_${Date.now()}_${code.length}`;
			
			outputter.startBlock();

			const wrappedCode = `
			try { eval(${JSON.stringify(code)}); } catch(e) { console.error(e); }
			process.stdout.write(${JSON.stringify(finishSigil)})&&undefined;
			`;

			outputter.clear();

			this.process.stdin.write(wrappedCode);


			outputter.on("data", (data: string) => {
				this.process.stdin.write(data);
			});

			const writeToStderr = (data: any) => {
				outputter.writeErr(data.toString());
			};

			const writeToStdout = (data: any) => {
				const stringData = data.toString();

				if (stringData.endsWith(finishSigil)) {
					outputter.write(
						stringData.substring(0, stringData.length - finishSigil.length)
					);
					
					this.process.removeListener("close", resolve);

					this.process.stdout.removeListener("data", writeToStdout);
					this.process.stderr.removeListener("data", writeToStderr);
					resolve();
				} else {
					outputter.write(stringData);
				}
			}
			
			this.process.addListener("close", resolve);

			this.process.stdout.on("data", writeToStdout);
			this.process.stderr.on("data", writeToStderr);
		});
	}

}
