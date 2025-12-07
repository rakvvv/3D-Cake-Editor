package com.cake.editor.dto;

public class CakeProjectSummaryDto {
    private Long id;
    private String name;
    private String createdAt;
    private String updatedAt;
    private boolean hasPainting;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(String createdAt) {
        this.createdAt = createdAt;
    }

    public String getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(String updatedAt) {
        this.updatedAt = updatedAt;
    }

    public boolean isHasPainting() {
        return hasPainting;
    }

    public void setHasPainting(boolean hasPainting) {
        this.hasPainting = hasPainting;
    }
}
