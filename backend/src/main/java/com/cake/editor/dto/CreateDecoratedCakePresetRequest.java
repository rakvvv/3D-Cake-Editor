package com.cake.editor.dto;

import jakarta.validation.constraints.NotBlank;

public class CreateDecoratedCakePresetRequest {
    @NotBlank
    private String presetId;

    @NotBlank
    private String name;

    private String description;

    private String thumbnailUrl;

    private String cakeShape;

    private String cakeSize;

    private Integer tiers;

    @NotBlank
    private String dataJson;

    public String getPresetId() {
        return presetId;
    }

    public void setPresetId(String presetId) {
        this.presetId = presetId;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        this.description = description;
    }

    public String getThumbnailUrl() {
        return thumbnailUrl;
    }

    public void setThumbnailUrl(String thumbnailUrl) {
        this.thumbnailUrl = thumbnailUrl;
    }

    public String getCakeShape() {
        return cakeShape;
    }

    public void setCakeShape(String cakeShape) {
        this.cakeShape = cakeShape;
    }

    public String getCakeSize() {
        return cakeSize;
    }

    public void setCakeSize(String cakeSize) {
        this.cakeSize = cakeSize;
    }

    public Integer getTiers() {
        return tiers;
    }

    public void setTiers(Integer tiers) {
        this.tiers = tiers;
    }

    public String getDataJson() {
        return dataJson;
    }

    public void setDataJson(String dataJson) {
        this.dataJson = dataJson;
    }
}
