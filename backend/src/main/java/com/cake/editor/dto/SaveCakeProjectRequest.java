package com.cake.editor.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public class SaveCakeProjectRequest {
    @NotBlank
    @Size(max = 200)
    private String name;

    @NotBlank
    @Size(max = 500000)
    private String dataJson;

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getDataJson() {
        return dataJson;
    }

    public void setDataJson(String dataJson) {
        this.dataJson = dataJson;
    }
}
