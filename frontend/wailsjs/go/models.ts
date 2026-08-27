export namespace main {
	
	export class SessionInfo {
	    id: string;
	    name: string;
	    path: string;
	    workspace: string;
	    updatedAt: number;
	    messageCount: number;
	
	    static createFrom(source: any = {}) {
	        return new SessionInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.path = source["path"];
	        this.workspace = source["workspace"];
	        this.updatedAt = source["updatedAt"];
	        this.messageCount = source["messageCount"];
	    }
	}
	export class Snapshot {
	    running: boolean;
	    workspace: string;
	    state?: any;
	    messages?: any;
	    models?: any;
	    lastError?: string;
	
	    static createFrom(source: any = {}) {
	        return new Snapshot(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.running = source["running"];
	        this.workspace = source["workspace"];
	        this.state = source["state"];
	        this.messages = source["messages"];
	        this.models = source["models"];
	        this.lastError = source["lastError"];
	    }
	}
	export class WorkspaceInfo {
	    path: string;
	    name: string;
	
	    static createFrom(source: any = {}) {
	        return new WorkspaceInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.name = source["name"];
	    }
	}
	export class WorkspaceRecord {
	    id: string;
	    path: string;
	    name: string;
	    pinned: boolean;
	    lastOpenedAt?: string;
	
	    static createFrom(source: any = {}) {
	        return new WorkspaceRecord(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.path = source["path"];
	        this.name = source["name"];
	        this.pinned = source["pinned"];
	        this.lastOpenedAt = source["lastOpenedAt"];
	    }
	}
	export class WorkspaceListResult {
	    workspaces: WorkspaceRecord[];
	    current: string;
	
	    static createFrom(source: any = {}) {
	        return new WorkspaceListResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.workspaces = this.convertValues(source["workspaces"], WorkspaceRecord);
	        this.current = source["current"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

