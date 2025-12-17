package com.cake.editor.dto;

public class UserDto {
    private Long id;
    private String email;
    private com.cake.editor.model.UserRole role;

    public UserDto() {
    }

    public UserDto(Long id, String email, com.cake.editor.model.UserRole role) {
        this.id = id;
        this.email = email;
        this.role = role;
    }

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public String getEmail() {
        return email;
    }

    public void setEmail(String email) {
        this.email = email;
    }

    public com.cake.editor.model.UserRole getRole() {
        return role;
    }

    public void setRole(com.cake.editor.model.UserRole role) {
        this.role = role;
    }
}
