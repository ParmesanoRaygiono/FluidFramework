/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import { strict as assert } from "assert";
import {
    MockFluidDataStoreRuntime,
    MockContainerRuntimeFactory,
    MockContainerRuntimeFactoryForReconnection,
    MockContainerRuntimeForReconnection,
    MockStorage,
} from "@fluidframework/test-runtime-utils";
import { TaskManager } from "../taskManager";
import { TaskManagerFactory } from "../taskManagerFactory";
import { ITaskManager } from "../interfaces";

function createConnectedTaskManager(id: string, runtimeFactory: MockContainerRuntimeFactory) {
    // Create and connect a TaskManager.
    const dataStoreRuntime = new MockFluidDataStoreRuntime();
    const containerRuntime = runtimeFactory.createContainerRuntime(dataStoreRuntime);
    const services = {
        deltaConnection: containerRuntime.createDeltaConnection(),
        objectStorage: new MockStorage(),
    };

    const taskManager = new TaskManager(id, dataStoreRuntime, TaskManagerFactory.Attributes);
    taskManager.connect(services);
    return taskManager;
}

const createLocalTaskManager = (id: string) =>
    new TaskManager(id, new MockFluidDataStoreRuntime(), TaskManagerFactory.Attributes);

describe("TaskManager", () => {
    describe("Local state", () => {
        let taskManager: TaskManager;

        beforeEach(() => {
            taskManager = createLocalTaskManager("taskmanager");
        });

        describe("APIs", () => {
            it("Can create a TaskManager", () => {
                assert.ok(taskManager, "Could not create a task manager");
            });
        });
    });

    describe("Connected state", () => {
        let taskManager1: ITaskManager;
        let taskManager2: ITaskManager;
        let containerRuntimeFactory: MockContainerRuntimeFactory;

        beforeEach(() => {
            containerRuntimeFactory = new MockContainerRuntimeFactory();
            taskManager1 = createConnectedTaskManager("taskManager1", containerRuntimeFactory);
            taskManager2 = createConnectedTaskManager("taskManager2", containerRuntimeFactory);
        });

        describe("Volunteering for a task", () => {
            it("Can volunteer for a task", async () => {
                const taskId = "taskId";
                const volunteerTaskP = taskManager1.volunteerForTask(taskId);
                assert.ok(taskManager1.queued(taskId), "Should be queued");
                assert.ok(!taskManager1.assigned(taskId), "Should not be assigned");
                containerRuntimeFactory.processAllMessages();
                const isAssigned = await volunteerTaskP;
                assert.ok(isAssigned, "Should resolve true");
                assert.ok(taskManager1.queued(taskId), "Should be queued");
                assert.ok(taskManager1.assigned(taskId), "Should be assigned");
            });

            it("Can wait for a task", async () => {
                const taskId = "taskId";
                const volunteerTaskP1 = taskManager1.volunteerForTask(taskId);
                const volunteerTaskP2 = taskManager2.volunteerForTask(taskId);

                assert.ok(taskManager1.queued(taskId), "Task manager 1 should be queued");
                assert.ok(!taskManager1.assigned(taskId), "Task manager 1 should not be assigned");
                assert.ok(taskManager2.queued(taskId), "Task manager 2 should be queued");
                assert.ok(!taskManager2.assigned(taskId), "Task manager 2 should not be assigned");

                containerRuntimeFactory.processAllMessages();
                const isAssigned1 = await volunteerTaskP1;
                assert.ok(isAssigned1, "Should resolve true");

                assert.ok(taskManager1.queued(taskId), "Task manager 1 should be queued");
                assert.ok(taskManager1.assigned(taskId), "Task manager 1 should be assigned");
                assert.ok(taskManager2.queued(taskId), "Task manager 2 should be queued");
                assert.ok(!taskManager2.assigned(taskId), "Task manager 2 should not be assigned");

                taskManager1.abandon(taskId);
                containerRuntimeFactory.processAllMessages();
                const isAssigned2 = await volunteerTaskP2;
                assert.ok(isAssigned2, "Should resolve true");

                assert.ok(!taskManager1.queued(taskId), "Task manager 1 should be queued");
                assert.ok(!taskManager1.assigned(taskId), "Task manager 1 should not be assigned");
                assert.ok(taskManager2.queued(taskId), "Task manager 2 should be queued");
                assert.ok(taskManager2.assigned(taskId), "Task manager 2 should not be assigned");
            });

            it("Rejects the promise if abandon before ack", async () => {
                const taskId = "taskId";
                const volunteerTaskP = taskManager1.volunteerForTask(taskId);
                taskManager1.abandon(taskId);
                // Will reject due to exiting the queue without first acquiring task
                // Promise should be settled already prior to processing messages
                await assert.rejects(volunteerTaskP);
                containerRuntimeFactory.processAllMessages();
                assert.ok(!taskManager1.queued(taskId), "Should not be queued");
                assert.ok(!taskManager1.assigned(taskId), "Should not be assigned");
            });

            it("Rejects the promise if abandon after ack but before acquire", async () => {
                const taskId = "taskId";
                const volunteerTaskP1 = taskManager1.volunteerForTask(taskId);
                const volunteerTaskP2 = taskManager2.volunteerForTask(taskId);

                assert.ok(taskManager1.queued(taskId), "Task manager 1 should be queued");
                assert.ok(!taskManager1.assigned(taskId), "Task manager 1 should not be assigned");
                assert.ok(taskManager2.queued(taskId), "Task manager 2 should be queued");
                assert.ok(!taskManager2.assigned(taskId), "Task manager 2 should not be assigned");

                containerRuntimeFactory.processAllMessages();
                const isAssigned = await volunteerTaskP1;
                assert.ok(isAssigned, "Should resolve true");

                assert.ok(taskManager1.queued(taskId), "Task manager 1 should be queued");
                assert.ok(taskManager1.assigned(taskId), "Task manager 1 should be assigned");
                assert.ok(taskManager2.queued(taskId), "Task manager 2 should be queued");
                assert.ok(!taskManager2.assigned(taskId), "Task manager 2 should not be assigned");

                taskManager2.abandon(taskId);
                // Will reject due to exiting the queue without first acquiring task
                // Promise should be settled already prior to processing messages
                await assert.rejects(volunteerTaskP2);
                containerRuntimeFactory.processAllMessages();
                assert.ok(!taskManager2.queued(taskId), "Should not be queued");
                assert.ok(!taskManager2.assigned(taskId), "Should not be assigned");
            });

            it("Can abandon and immediately attempt to reacquire a task", async () => {
                const taskId = "taskId";
                const volunteerTaskP = taskManager1.volunteerForTask(taskId);
                assert.ok(taskManager1.queued(taskId), "Should be queued");
                assert.ok(!taskManager1.assigned(taskId), "Should not be assigned");
                containerRuntimeFactory.processAllMessages();
                const isAssigned = await volunteerTaskP;
                assert.ok(isAssigned, "Should resolve true");
                assert.ok(taskManager1.queued(taskId), "Should be queued");
                assert.ok(taskManager1.assigned(taskId), "Should be assigned");

                taskManager1.abandon(taskId);
                assert.ok(!taskManager1.queued(taskId), "Should not be queued");
                assert.ok(!taskManager1.assigned(taskId), "Should not be assigned");
                const revolunteerTaskP = taskManager1.volunteerForTask(taskId);
                assert.ok(taskManager1.queued(taskId), "Should be queued");
                assert.ok(!taskManager1.assigned(taskId), "Should not be assigned");
                containerRuntimeFactory.processAllMessages();
                const isAssigned2 = await revolunteerTaskP;
                assert.ok(isAssigned2, "Should resolve true");
                assert.ok(taskManager1.queued(taskId), "Should be queued");
                assert.ok(taskManager1.assigned(taskId), "Should be assigned");
            });

            it("Can attempt to volunteer for task twice and abandon twice (after ack)", async () => {
                const taskId = "taskId";
                const volunteerTaskP1 = taskManager1.volunteerForTask(taskId);
                assert.ok(taskManager1.queued(taskId), "Should be queued");
                assert.ok(!taskManager1.assigned(taskId), "Should not be assigned");
                containerRuntimeFactory.processAllMessages();
                const isAssigned1 = await volunteerTaskP1;
                assert.ok(isAssigned1, "Should resolve true");
                assert.ok(taskManager1.queued(taskId), "Should be queued");
                assert.ok(taskManager1.assigned(taskId), "Should be assigned");

                const volunteerTaskP2 = taskManager1.volunteerForTask(taskId);
                assert.ok(taskManager1.queued(taskId), "Should be queued");
                assert.ok(taskManager1.assigned(taskId), "Should be assigned");
                containerRuntimeFactory.processAllMessages();
                const isAssigned2 = await volunteerTaskP2;
                assert.ok(isAssigned2, "Should resolve true");
                assert.ok(taskManager1.queued(taskId), "Should be queued");
                assert.ok(taskManager1.assigned(taskId), "Should be assigned");

                taskManager1.abandon(taskId);
                assert.ok(!taskManager1.queued(taskId), "Should not be queued");
                assert.ok(!taskManager1.assigned(taskId), "Should not be assigned");
                containerRuntimeFactory.processAllMessages();
                assert.ok(!taskManager1.queued(taskId), "Should not be queued");
                assert.ok(!taskManager1.assigned(taskId), "Should not be assigned");

                taskManager1.abandon(taskId);
                assert.ok(!taskManager1.queued(taskId), "Should not be queued");
                assert.ok(!taskManager1.assigned(taskId), "Should not be assigned");
                containerRuntimeFactory.processAllMessages();
                assert.ok(!taskManager1.queued(taskId), "Should not be queued");
                assert.ok(!taskManager1.assigned(taskId), "Should not be assigned");
            });

            it("Can attempt to lock task twice and abandon twice (before ack)", async () => {
                const taskId = "taskId";
                const volunteerTaskP1 = taskManager1.volunteerForTask(taskId);
                assert.ok(taskManager1.queued(taskId), "Should be queued");
                assert.ok(!taskManager1.assigned(taskId), "Should not be assigned");

                const volunteerTaskP2 = taskManager1.volunteerForTask(taskId);
                assert.ok(taskManager1.queued(taskId), "Should be queued");
                assert.ok(!taskManager1.assigned(taskId), "Should not be assigned");
                containerRuntimeFactory.processAllMessages();
                const isAssigned1 = await volunteerTaskP1;
                assert.ok(isAssigned1, "Should resolve true");
                const isAssigned2 = await volunteerTaskP2;
                assert.ok(isAssigned2, "Should resolve true");
                assert.ok(taskManager1.queued(taskId), "Should be queued");
                assert.ok(taskManager1.assigned(taskId), "Should be assigned");

                taskManager1.abandon(taskId);
                assert.ok(!taskManager1.queued(taskId), "Should not be queued");
                assert.ok(!taskManager1.assigned(taskId), "Should not be assigned");
                taskManager1.abandon(taskId);
                assert.ok(!taskManager1.queued(taskId), "Should not be queued");
                assert.ok(!taskManager1.assigned(taskId), "Should not be assigned");
                containerRuntimeFactory.processAllMessages();
                assert.ok(!taskManager1.queued(taskId), "Should not be queued");
                assert.ok(!taskManager1.assigned(taskId), "Should not be assigned");
            });

            it("Can volunteer for a task immediately after it was completed", async () => {
                const taskId = "taskId";
                const volunteerTaskP = taskManager1.volunteerForTask(taskId);
                containerRuntimeFactory.processAllMessages();
                await volunteerTaskP;

                taskManager2.subscribeToTask(taskId);
                taskManager1.complete(taskId);
                const volunteerTaskP2 = taskManager1.volunteerForTask(taskId);
                containerRuntimeFactory.processAllMessages();
                await volunteerTaskP2;
                assert.ok(taskManager1.assigned(taskId), "taskManager1 should be assigned");
                assert.ok(!taskManager2.queued(taskId), "taskManager 2 should not be assigned");
            });
        });

        describe("Subscribing to a task", () => {
            it("Can subscribe to a task", async () => {
                const taskId = "taskId";
                taskManager1.subscribeToTask(taskId);

                assert.ok(taskManager1.queued(taskId), "Task manager 1 should be queued");
                assert.ok(!taskManager1.assigned(taskId), "Task manager 1 should not be assigned");
                assert.ok(taskManager1.subscribed(taskId), "Task manager 1 should be subscribed");

                containerRuntimeFactory.processAllMessages();

                assert.ok(taskManager1.queued(taskId), "Task manager 1 should be queued");
                assert.ok(taskManager1.assigned(taskId), "Task manager 1 should be assigned");
                assert.ok(taskManager1.subscribed(taskId), "Task manager 1 should be subscribed");
            });

            it("Can abandon a subscribed task", async () => {
                const taskId = "taskId";
                taskManager1.subscribeToTask(taskId);
                containerRuntimeFactory.processAllMessages();

                taskManager1.abandon(taskId);
                containerRuntimeFactory.processAllMessages();

                assert.ok(!taskManager1.queued(taskId), "Task manager 1 should not be queued");
                assert.ok(!taskManager1.assigned(taskId), "Task manager 1 should not be assigned");
                assert.ok(!taskManager1.subscribed(taskId), "Task manager 1 should not be subscribed");
            });

            it("Can subscribe and wait for a task", async () => {
                const taskId = "taskId";
                taskManager1.subscribeToTask(taskId);
                taskManager2.subscribeToTask(taskId);

                assert.ok(taskManager1.queued(taskId), "Task manager 1 should be queued");
                assert.ok(!taskManager1.assigned(taskId), "Task manager 1 should not be assigned");
                assert.ok(taskManager2.queued(taskId), "Task manager 2 should be queued");
                assert.ok(!taskManager2.assigned(taskId), "Task manager 2 should not be assigned");

                containerRuntimeFactory.processAllMessages();

                assert.ok(taskManager1.queued(taskId), "Task manager 1 should be queued");
                assert.ok(taskManager1.assigned(taskId), "Task manager 1 should be assigned");
                assert.ok(taskManager2.queued(taskId), "Task manager 2 should be queued");
                assert.ok(!taskManager2.assigned(taskId), "Task manager 2 should not be assigned");

                taskManager1.abandon(taskId);
                containerRuntimeFactory.processAllMessages();
                assert.ok(taskManager2.assigned(taskId), "Task manager 2 should be assigned");
            });
        });

        describe("Completing tasks", () => {
            it("Can complete a task", async () => {
                const taskId = "taskId";
                const volunteerTaskP = taskManager1.volunteerForTask(taskId);
                containerRuntimeFactory.processAllMessages();
                await volunteerTaskP;
                assert.ok(taskManager1.assigned(taskId), "Should be assigned");

                taskManager1.complete(taskId);
                containerRuntimeFactory.processAllMessages();
                assert.ok(!taskManager1.queued(taskId), "Should not be queued");
                assert.ok(!taskManager1.assigned(taskId), "Should not be assigned");
            });

            it("Rejects the promise if you try to complete without being assigned", async () => {
                const taskId = "taskId";
                const volunteerTaskP1 = taskManager1.volunteerForTask(taskId);
                void taskManager2.volunteerForTask(taskId);

                containerRuntimeFactory.processAllMessages();
                await volunteerTaskP1;

                assert.ok(taskManager1.assigned(taskId), "Task manager 1 should be assigned");
                assert.ok(taskManager2.queued(taskId), "Task manager 2 should be queued");
                assert.ok(!taskManager2.assigned(taskId), "Task manager 2 should not be assigned");

                assert.throws(() => { taskManager2.complete(taskId); }, "Should throw error");
                containerRuntimeFactory.processAllMessages();
                assert.ok(taskManager1.assigned(taskId), "Task manager 1 should be assigned");
            });

            it("Can complete a task and remove other clients from queue", async () => {
                const taskId = "taskId";
                const volunteerTaskP1 = taskManager1.volunteerForTask(taskId);
                const volunteerTaskP2 = taskManager2.volunteerForTask(taskId);

                containerRuntimeFactory.processAllMessages();
                const isAssigned1 = await volunteerTaskP1;
                assert.ok(isAssigned1, "Should resolve true");

                assert.ok(taskManager1.assigned(taskId), "Task manager 1 should be assigned");
                assert.ok(taskManager2.queued(taskId), "Task manager 2 should be queued");
                assert.ok(!taskManager2.assigned(taskId), "Task manager 2 should not be assigned");

                taskManager1.complete(taskId);
                containerRuntimeFactory.processAllMessages();
                const isAssigned2 = await volunteerTaskP2;
                assert.ok(!isAssigned2, "Should resolve false");

                assert.ok(!taskManager1.queued(taskId), "Task manager 1 should not be queued");
                assert.ok(!taskManager2.queued(taskId), "Task manager 2 should not be queued");
            });

            it("Can complete a task and remove other subscribed clients from queue", async () => {
                const taskId = "taskId";
                taskManager1.subscribeToTask(taskId);
                taskManager2.subscribeToTask(taskId);
                containerRuntimeFactory.processAllMessages();

                assert.ok(taskManager1.assigned(taskId), "Task manager 1 should be assigned");
                assert.ok(taskManager2.queued(taskId), "Task manager 2 should be queued");
                assert.ok(!taskManager2.assigned(taskId), "Task manager 2 should not be assigned");

                taskManager1.complete(taskId);
                containerRuntimeFactory.processAllMessages();

                assert.ok(!taskManager1.queued(taskId), "Task manager 1 should not be queued");
                assert.ok(!taskManager2.queued(taskId), "Task manager 2 should not be queued");
            });

            it("Can emit completed event", async () => {
                const taskId = "taskId";
                const volunteerTaskP1 = taskManager1.volunteerForTask(taskId);
                taskManager2.subscribeToTask(taskId);

                containerRuntimeFactory.processAllMessages();
                await volunteerTaskP1;

                let taskManager1EventFired = false;
                let taskManager2EventFired = false;
                taskManager1.once("completed", (completedTaskId: string) => {
                    assert.ok(completedTaskId === taskId, "taskId should match");
                    assert.ok(!taskManager1EventFired, "Should only fire completed event once on taskManager1");
                    taskManager1EventFired = true;
                });
                taskManager2.once("completed", (completedTaskId: string) => {
                    assert.ok(completedTaskId === taskId, "taskId should match");
                    assert.ok(!taskManager2EventFired, "Should only fire completed event once on taskManager2");
                    taskManager2EventFired = true;
                });
                taskManager1.complete(taskId);
                containerRuntimeFactory.processAllMessages();
                assert.ok(taskManager1EventFired, "Should have raised completed event on taskManager1");
                assert.ok(taskManager2EventFired, "Should have raised completed event on taskManager2");
            });

            it("Can complete a task with a pending volunteer op", async () => {
                const taskId = "taskId";
                const volunteerTaskP1 = taskManager1.volunteerForTask(taskId);

                containerRuntimeFactory.processAllMessages();
                await volunteerTaskP1;

                let taskManager1EventFired = false;
                let taskManager2EventFired = false;
                taskManager1.on("completed", (completedTaskId: string) => {
                    assert.ok(completedTaskId === taskId, "taskId should match");
                    assert.ok(!taskManager1EventFired, "Should only fire completed event once on taskManager1");
                    taskManager1EventFired = true;
                });
                taskManager2.on("completed", (completedTaskId: string) => {
                    assert.ok(completedTaskId === taskId, "taskId should match");
                    assert.ok(!taskManager2EventFired, "Should only fire completed event once on taskManager2");
                    taskManager2EventFired = true;
                });

                const volunteerTaskP2 = taskManager2.volunteerForTask(taskId);
                taskManager1.complete(taskId);
                containerRuntimeFactory.processAllMessages();
                await volunteerTaskP2;

                assert.ok(taskManager1EventFired, "Should have raised completed event on taskManager1");
                assert.ok(taskManager2EventFired, "Should have raised completed event on taskManager2");
                assert.ok(!taskManager1.queued(taskId), "Task manager 1 should not be queued");
                assert.ok(!taskManager2.queued(taskId), "Task manager 2 should not be queued");
            });
        });
    });

    describe.skip("Detached/Attach", () => {
        describe("Behavior before attach", () => { });
        describe("Behavior after attaching", () => { });
    });

    describe("Disconnect/Reconnect", () => {
        let containerRuntimeFactory: MockContainerRuntimeFactoryForReconnection;
        let containerRuntime1: MockContainerRuntimeForReconnection;
        let containerRuntime2: MockContainerRuntimeForReconnection;
        let taskManager1: TaskManager;
        let taskManager2: TaskManager;

        beforeEach(async () => {
            containerRuntimeFactory = new MockContainerRuntimeFactoryForReconnection();

            // Create the first SharedMap.
            const dataStoreRuntime1 = new MockFluidDataStoreRuntime();
            containerRuntime1 = containerRuntimeFactory.createContainerRuntime(dataStoreRuntime1);
            const services1 = {
                deltaConnection: containerRuntime1.createDeltaConnection(),
                objectStorage: new MockStorage(),
            };
            taskManager1 = new TaskManager("task-manager-1", dataStoreRuntime1, TaskManagerFactory.Attributes);
            taskManager1.connect(services1);

            // Create the second TaskManager.
            const dataStoreRuntime2 = new MockFluidDataStoreRuntime();
            containerRuntime2 = containerRuntimeFactory.createContainerRuntime(dataStoreRuntime2);
            const services2 = {
                deltaConnection: containerRuntime2.createDeltaConnection(),
                objectStorage: new MockStorage(),
            };
            taskManager2 = new TaskManager("task-manager-2", dataStoreRuntime2, TaskManagerFactory.Attributes);
            taskManager2.connect(services2);
        });

        describe("Behavior transitioning to disconnect", () => {
            describe("Volunteering for a task", () => {
                it("Disconnect while assigned: Raises a lost event and loses the task assignment", async () => {
                    const taskId = "taskId";
                    const volunteerTaskP = taskManager1.volunteerForTask(taskId);
                    containerRuntimeFactory.processAllMessages();
                    const isAssigned = await volunteerTaskP;
                    assert.ok(isAssigned, "Should resolve true");
                    assert.ok(taskManager1.assigned(taskId), "Should be assigned");

                    let lostRaised = false;
                    taskManager1.once("lost", () => { lostRaised = true; });

                    containerRuntime1.connected = false;
                    containerRuntimeFactory.processAllMessages();
                    assert.ok(!taskManager1.assigned(taskId), "Should not be assigned");
                    assert.ok(lostRaised, "Should have raised a lost event");
                });

                it("Disconnect while queued: Rejects the volunteerForTask promise and exits the queue", async () => {
                    const taskId = "taskId";
                    const volunteerTaskP1 = taskManager1.volunteerForTask(taskId);
                    const volunteerTaskP2 = taskManager2.volunteerForTask(taskId);
                    containerRuntimeFactory.processAllMessages();
                    const isAssigned = await volunteerTaskP1;
                    assert.ok(isAssigned, "Should resolve true");
                    assert.ok(taskManager1.assigned(taskId), "Task manager 1 Should be assigned");
                    assert.ok(taskManager2.queued(taskId), "Task manager 2 should be queued");
                    assert.ok(!taskManager2.assigned(taskId), "Task manager 2 should not be assigned");

                    containerRuntime2.connected = false;
                    containerRuntimeFactory.processAllMessages();
                    await assert.rejects(volunteerTaskP2, "Should have rejected the P2 promise");
                    assert.ok(!taskManager2.queued(taskId), "Task manager 2 should not be queued");
                    assert.ok(!taskManager2.assigned(taskId), "Task manager 2 should not be assigned");
                });

                it("Disconnect while queued: Removed from the queue for other clients", async () => {
                    const taskId = "taskId";
                    const volunteerTaskP1 = taskManager1.volunteerForTask(taskId);
                    taskManager2.subscribeToTask(taskId);
                    containerRuntimeFactory.processAllMessages();
                    await volunteerTaskP1;
                    const clientId1 = containerRuntime1.clientId;
                    const clientId2 = containerRuntime2.clientId;

                    assert.deepEqual(taskManager1._getTaskQueues().get(taskId), [clientId1, clientId2],
                        "Task queue should have both clients");

                    containerRuntime2.connected = false;
                    containerRuntimeFactory.processAllMessages();

                    assert.deepEqual(taskManager1._getTaskQueues().get(taskId), [clientId1],
                        "Task queue should only have client 1");
                });

                it("Disconnect while pending: Rejects the volunteerForTask promise", async () => {
                    const taskId = "taskId";
                    const volunteerTaskP = taskManager1.volunteerForTask(taskId);
                    containerRuntime1.connected = false;
                    containerRuntimeFactory.processAllMessages();
                    await assert.rejects(volunteerTaskP, "Should have rejected the promise");
                    assert.ok(!taskManager1.queued(taskId), "Should not be queued");
                    assert.ok(!taskManager1.assigned(taskId), "Should not be assigned");
                });
            });

            describe("Subscribing to a task", () => { });

            describe("Completing tasks", () => { });
        });

        describe("Behavior while disconnected", () => {
            describe("Volunteering for a task", () => {
                it("Immediately rejects attempts to lock task and throws on abandon", async () => {
                    const taskId = "taskId";
                    containerRuntime1.connected = false;
                    containerRuntimeFactory.processAllMessages();

                    const volunteerTaskP = taskManager1.volunteerForTask(taskId);
                    assert.ok(!taskManager1.queued(taskId), "Should not be queued");
                    assert.ok(!taskManager1.assigned(taskId), "Should not be assigned");
                    await assert.rejects(volunteerTaskP);
                    containerRuntimeFactory.processAllMessages();
                    assert.ok(!taskManager1.queued(taskId), "Should not be queued");
                    assert.ok(!taskManager1.assigned(taskId), "Should not be assigned");
                });
            });

            describe("Subscribing to a task", () => {
                it("Can subscribe while disconnected", async () => {
                    const taskId = "taskId";
                    containerRuntime1.connected = false;
                    containerRuntimeFactory.processAllMessages();

                    taskManager1.subscribeToTask(taskId);
                    assert.ok(!taskManager1.queued(taskId), "Should not be queued");
                    assert.ok(!taskManager1.assigned(taskId), "Should not be assigned");
                    assert.ok(taskManager1.subscribed(taskId), "Task manager 1 should be subscribed");

                    containerRuntimeFactory.processAllMessages();
                    assert.ok(!taskManager1.queued(taskId), "Should not be queued");
                    assert.ok(!taskManager1.assigned(taskId), "Should not be assigned");
                    assert.ok(taskManager1.subscribed(taskId), "Task manager 1 should be subscribed");

                    containerRuntime1.connected = true;
                    containerRuntimeFactory.processAllMessages();
                    assert.ok(taskManager1.queued(taskId), "Should be queued");
                    assert.ok(taskManager1.assigned(taskId), "Should be assigned");
                    assert.ok(taskManager1.subscribed(taskId), "Task manager 1 should be subscribed");
                });

                it("Can abandon subscription while disconnected", async () => {
                    const taskId = "taskId";
                    containerRuntime1.connected = false;
                    containerRuntimeFactory.processAllMessages();

                    taskManager1.subscribeToTask(taskId);
                    taskManager1.abandon(taskId);
                    containerRuntimeFactory.processAllMessages();

                    containerRuntime1.connected = true;
                    containerRuntimeFactory.processAllMessages();
                    assert.ok(!taskManager1.queued(taskId), "Should not be queued");
                    assert.ok(!taskManager1.assigned(taskId), "Should not be assigned");
                    assert.ok(!taskManager1.subscribed(taskId), "Task manager 1 should not be subscribed");
                });
            });

            describe("Completing tasks", () => {
                it("Immediately throws on attempt to complete task", async () => {
                    const taskId = "taskId";
                    containerRuntime1.connected = false;
                    containerRuntimeFactory.processAllMessages();

                    assert.throws(() => { taskManager1.complete(taskId); }, "Should throw error");
                    containerRuntimeFactory.processAllMessages();
                });
            });
        });

        describe("Behavior transitioning to connected", () => {
            describe("Volunteering for a task", () => {
                it("Does not re-attempt to enter the queue for un-ack'd ops", async () => {
                    const taskId = "taskId";
                    const volunteerTaskP = taskManager1.volunteerForTask(taskId);
                    containerRuntime1.connected = false;
                    containerRuntimeFactory.processAllMessages();
                    await assert.rejects(volunteerTaskP, "Should have rejected the promise");
                    containerRuntime1.connected = true;
                    containerRuntimeFactory.processAllMessages();
                    assert.ok(!taskManager1.queued(taskId), "Should not be queued");
                    assert.ok(!taskManager1.assigned(taskId), "Should not be assigned");
                });
            });

            describe("Subscribing to a task", () => {
                it("Does re-attempt to enter the queue when subscribed", async () => {
                    const taskId = "taskId";
                    taskManager1.subscribeToTask(taskId);
                    containerRuntimeFactory.processAllMessages();

                    containerRuntime1.connected = false;

                    assert.ok(!taskManager1.queued(taskId), "Task manager 1 should not be queued");
                    assert.ok(!taskManager1.assigned(taskId), "Task manager 1 should not be assigned");
                    assert.ok(taskManager1.subscribed(taskId), "Task manager 1 should be subscribed");

                    containerRuntime1.connected = true;

                    assert.ok(taskManager1.queued(taskId), "Task manager 1 should be queued");
                    assert.ok(!taskManager1.assigned(taskId), "Task manager 1 should not be assigned");
                    assert.ok(taskManager1.subscribed(taskId), "Task manager 1 should be subscribed");

                    containerRuntimeFactory.processAllMessages();

                    assert.ok(taskManager1.queued(taskId), "Task manager 1 should be queued");
                    assert.ok(taskManager1.assigned(taskId), "Task manager 1 should be assigned");
                    assert.ok(taskManager1.subscribed(taskId), "Task manager 1 should be subscribed");
                });
            });

            describe("Completing tasks", () => { });
        });
    });
});
