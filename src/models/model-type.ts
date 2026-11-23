/** Model-kind narrowing; `isModelType` is missing from oh-my-pi's bundled pi-ai. */
import type { AnyModel, ModelType, ModelTypeMap } from "@earendil-works/pi-ai";

/** Models without `type` are chat models, matching pi-ai's own default. */
export function modelType(model: AnyModel): ModelType {
	return model.type ?? "chat";
}

export function isModelType<TType extends ModelType>(
	model: AnyModel,
	type: TType,
): model is ModelTypeMap[TType] {
	return modelType(model) === type;
}
