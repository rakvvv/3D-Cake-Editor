package com.cake.editor.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

public enum ModelFormat {
    GLTF,
    OBJ,
    STL;

    @JsonValue
    public String getSerializedName() {
        return name().toLowerCase();
    }

    @JsonCreator
    public static ModelFormat fromString(String value) {
        for (ModelFormat format : values()) {
            if (format.name().equalsIgnoreCase(value)) {
                return format;
            }
        }
        throw new IllegalArgumentException("Unsupported format: " + value);
    }
}
