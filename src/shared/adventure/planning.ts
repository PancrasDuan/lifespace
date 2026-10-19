import type { AdventureCommand } from "./commands";
import type { Container, Goal } from "./model";
import type { Operations } from "./operations";
import { cmp, fail } from "./dates";

export function planning(o: Operations, c: AdventureCommand): boolean {
  const {
    s,
    ctx,
    result,
    id,
    container,
    goal,
    writableContainer,
    writableGoal,
    nameAvailable,
  } = o;
  switch (c.type) {
    case "createContainer": {
      if (c.kind === "main") {
        if (s.containers.filter((v) => v.kind === "main").length >= 5)
          fail("主线最多5条");
        nameAvailable(c.name);
      } else if (
        s.containers.filter(
          (v) =>
            v.kind === "side" &&
            !v.archived &&
            !v.convertedTo &&
            !s.goals.some((g) => g.containerId === v.id && g.completion),
        ).length >= 10
      )
        fail("在用支线最多10条");
      const v = { id: id(), kind: c.kind, name: c.name, archived: false };
      s.containers.push(v);
      result.entityId = v.id;
      break;
    }
    case "editContainer": {
      const v = writableContainer(c.id);
      if (v.kind === "main") nameAvailable(c.name, v.id);
      v.name = c.name;
      break;
    }
    case "createGoal": {
      const v = writableContainer(c.containerId);
      if (v.kind === "side" && s.goals.some((g) => g.containerId === v.id))
        fail("支线最多1个目标");
      const g: Goal = {
        id: id(),
        containerId: v.id,
        title: c.title,
        standard: c.standard,
        focused: false,
        order: s.goals.filter((g) => g.containerId === v.id).length,
        archived: false,
      };
      s.goals.push(g);
      result.entityId = g.id;
      break;
    }
    case "editGoal": {
      const g = writableGoal(c.id);
      g.title = c.title;
      g.standard = c.standard;
      break;
    }
    case "focusGoal": {
      const g = writableGoal(c.id),
        v = container(g.containerId);
      if (
        c.focused &&
        v.kind === "main" &&
        s.goals.filter(
          (x) =>
            x.containerId === v.id &&
            x.focused &&
            x.id !== g.id &&
            !x.archived &&
            !x.completion,
        ).length >= 3
      )
        fail("每条主线最多聚焦3个目标");
      g.focused = c.focused;
      break;
    }
    case "reorderGoals": {
      const v = writableContainer(c.containerId),
        items = s.goals.filter((g) => g.containerId === v.id);
      if (
        v.kind !== "main" ||
        new Set(c.goalIds).size !== items.length ||
        c.goalIds.length !== items.length ||
        items.some((g) => !c.goalIds.includes(g.id))
      )
        fail("只能排列同一主线的全部目标");
      c.goalIds.forEach((key, i) => {
        goal(key).order = i;
      });
      break;
    }
    case "migrateSide": {
      const source = writableContainer(c.id);
      if (source.kind !== "side") fail("只有支线可升级迁移");
      const g = s.goals.find((g) => g.containerId === source.id);
      if (g?.archived) fail("归档目标不能迁移");
      if (!!c.targetContainerId === !!c.newMainName)
        fail("选择迁入主线或新主线名称");
      let target: Container;
      if (c.targetContainerId) {
        target = writableContainer(c.targetContainerId);
        if (target.kind !== "main" || !g) fail("请选择主线及支线目标");
        if (
          g.focused &&
          s.goals.filter(
            (x) =>
              x.containerId === target.id &&
              x.focused &&
              !x.archived &&
              !x.completion,
          ).length >= 3
        )
          fail("目标主线已聚焦3个，请先调整");
      } else {
        if (s.containers.filter((v) => v.kind === "main").length >= 5)
          fail("主线最多5条");
        nameAvailable(c.newMainName!);
        target = {
          id: id(),
          kind: "main",
          name: c.newMainName!,
          archived: false,
        };
        s.containers.push(target);
      }
      source.convertedTo = target.id;
      source.sourceGoalId = g?.id;
      source.archived = true;
      if (g) {
        g.sourceContainerId = source.id;
        g.containerId = target.id;
        g.order = s.goals.filter(
          (x) => x.containerId === target.id && x.id !== g.id,
        ).length;
      }
      result.entityId = target.id;
      break;
    }
    case "archive": {
      let targets: Goal[];
      if (c.kind === "container") {
        const v = writableContainer(c.id);
        v.archived = true;
        targets = s.goals.filter((g) => g.containerId === v.id);
      } else {
        const g = goal(c.id);
        writableContainer(g.containerId);
        if (g.archived) fail("目标已经归档");
        targets = [g];
      }
      for (const g of targets) {
        g.archived = true;
        g.focused = false;
        for (const cy of s.cycles.filter(
          (cy) => cy.goalId === g.id && cy.status !== "ended",
        )) {
          cy.status = "ended";
          cy.endedAt = ctx.today;
          cy.endedRecordedOn = ctx.today;
          delete cy.endedByGoal;
          for (const pause of cy.pauses) if (!pause.end) pause.end = ctx.today;
        }
        for (const t of s.tasks)
          if (
            t.goalId === g.id &&
            !t.completedOn &&
            cmp(t.date, ctx.today) >= 0
          ) {
            t.stopped = true;
            delete t.stoppedByGoal;
          }
      }
      break;
    }
    default:
      return false;
  }
  return true;
}
